"""
WorkflowRunner: Executes the recruitment pipeline for a given WorkflowRun.
Runs in a background task, persisting candidate and state changes to the DB.
"""
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.core.database import AsyncSessionLocal
from app.models.workflow import WorkflowRun, Workflow, WorkflowStepConfig
from app.models.candidate import Candidate, CandidateEvent
from app.models.outreach import OutreachEmail
from app.agents.sourcing import SourcingAgent
from app.agents.filtering import FilteringAgent
from app.agents.outreach import OutreachAgent


class WorkflowRunner:
    @staticmethod
    async def execute(run_id: int):
        """Execute the recruitment pipeline for the given run_id."""
        async with AsyncSessionLocal() as db:
            try:
                run = await WorkflowRunner._get_run(db, run_id)
                workflow = await WorkflowRunner._get_workflow(db, run.workflow_id)
                step_configs = await WorkflowRunner._get_step_configs(db, workflow.id)

                run.status = "running"
                run.current_step = "sourcing"
                await db.commit()

                # Step 1: Sourcing
                sourcing_cfg = step_configs.get("sourcing", {})
                sourcing_agent = SourcingAgent()
                sourcing_result = await sourcing_agent.run({
                    "job_title": workflow.job_title,
                    "job_description": workflow.job_description or "",
                    "location": workflow.location,
                    "seniority": workflow.seniority,
                    "keywords": workflow.keywords,
                    "max_candidates": sourcing_cfg.get("max_candidates", 20),
                    "min_candidates": sourcing_cfg.get("min_candidates", 25),
                    # Always include default test candidate(s) for workflow verification.
                    "include_test_profile": True,
                })
                unique_profiles: list[dict] = []
                seen_keys: set[str] = set()
                for profile in sourcing_result["candidates"]:
                    email = (profile.get("email") or "").strip().lower()
                    phone = "".join(ch for ch in str(profile.get("phone") or "") if ch.isdigit())
                    linkedin = (profile.get("linkedin_url") or "").strip().lower().rstrip("/")
                    fallback = f"{(profile.get('full_name') or '').strip().lower()}|{(profile.get('current_company') or '').strip().lower()}"
                    dedupe_key = f"email:{email}" if email else (f"phone:{phone}" if len(phone) >= 8 else (f"url:{linkedin}" if linkedin else f"name_company:{fallback}"))
                    if dedupe_key in seen_keys:
                        continue
                    seen_keys.add(dedupe_key)
                    unique_profiles.append(profile)
                sourcing_result["candidates"] = unique_profiles

                # Persist raw candidates
                candidate_ids = []
                for i, profile in enumerate(sourcing_result["candidates"]):
                    candidate = Candidate(
                        workflow_run_id=run_id,
                        full_name=profile.get("full_name", f"Candidate {i+1}"),
                        headline=profile.get("headline"),
                        linkedin_url=profile.get("linkedin_url"),
                        location=profile.get("location"),
                        skills=profile.get("skills", []),
                        experience_years=profile.get("experience_years"),
                        experience=profile.get("experience", []),
                        education=profile.get("education", []),
                        email=profile.get("email"),
                        phone=profile.get("phone"),
                        current_company=profile.get("current_company"),
                        profile_description=profile.get("profile_description"),
                        profile_summary=profile.get("profile_summary"),
                        resume_url=profile.get("resume_url"),
                        status="sourced",
                        sourced_at=datetime.now(timezone.utc),
                    )
                    db.add(candidate)
                    await db.flush()
                    profile["id"] = candidate.id
                    candidate_ids.append(candidate.id)
                    db.add(CandidateEvent(
                        candidate_id=candidate.id,
                        event_type="sourced",
                        agent="sourcing_agent",
                        description="Candidate sourced from LinkedIn",
                        event_metadata={"linkedin_url": profile.get("linkedin_url")},
                    ))

                await db.commit()

                # Step 2: Filtering (if enabled)
                filtering_cfg = step_configs.get("filtering", {"enabled": True})
                if filtering_cfg.get("enabled", True):
                    run.current_step = "filtering"
                    await db.commit()
                    filtering_agent = FilteringAgent()
                    candidates_data = [
                        {
                            "id": p["id"],
                            "full_name": p.get("full_name"),
                            "headline": p.get("headline"),
                            "skills": p.get("skills", []),
                            "experience_years": p.get("experience_years"),
                            "experience": p.get("experience", []),
                            "education": p.get("education", []),
                            "profile_summary": p.get("profile_summary"),
                            "profile_description": p.get("profile_description"),
                            "location": p.get("location"),
                        }
                        for p in sourcing_result["candidates"]
                    ]
                    filter_result = await filtering_agent.run({
                        "candidates": candidates_data,
                        "job_title": workflow.job_title,
                        "job_description": workflow.job_description or "",
                        "required_skills": filtering_cfg.get("required_skills", []),
                        "preferred_skills": filtering_cfg.get("preferred_skills", []),
                        "strict_skill_match": filtering_cfg.get("strict_skill_match", False),
                        "min_experience_years": filtering_cfg.get("min_experience_years", 0),
                        "max_experience_years": filtering_cfg.get("max_experience_years"),
                        "min_score_threshold": filtering_cfg.get("min_score_threshold", 5.0),
                    })
                    min_score_threshold = float(filtering_cfg.get("min_score_threshold", 5.0))

                    for scored in filter_result["candidates"]:
                        cand_result = await db.execute(
                            select(Candidate).where(Candidate.id == scored["id"])
                        )
                        cand = cand_result.scalar_one_or_none()
                        if cand:
                            cand.ai_score = scored.get("ai_score")
                            cand.ai_score_reason = scored.get("ai_score_reason")
                            ai_status = scored.get("status", "filtered")
                            # Defensive enforcement: low AI score must always be rejected.
                            if cand.ai_score is not None and cand.ai_score < min_score_threshold:
                                ai_status = "rejected"
                            cand.status = ai_status
                            # Keep recruiter decision empty by default.
                            # Rejection decision should be explicit by recruiter action.
                            cand.filtered_at = datetime.now(timezone.utc)
                            db.add(CandidateEvent(
                                candidate_id=cand.id,
                                event_type="filtered",
                                agent="filtering_agent",
                                description=f"AI Score: {scored.get('ai_score', 0):.1f}/10",
                                event_metadata={
                                    "score": scored.get("ai_score"),
                                    "reason": scored.get("ai_score_reason"),
                                },
                            ))

                    await db.commit()
                else:
                    for candidate_id in candidate_ids:
                        cand_result = await db.execute(
                            select(Candidate).where(Candidate.id == candidate_id)
                        )
                        cand = cand_result.scalar_one_or_none()
                        if cand:
                            cand.status = "filtered"
                            cand.filtered_at = datetime.now(timezone.utc)
                            db.add(CandidateEvent(
                                candidate_id=cand.id,
                                event_type="filtered",
                                agent="filtering_agent",
                                description="Filtering disabled; candidate moved to manual review",
                                event_metadata={"skipped": True},
                            ))
                    await db.commit()

                # Pause at Checkpoint 1 — human review
                run.current_step = "checkpoint_1"
                run.status = "waiting_review"
                await db.commit()

            except Exception as e:
                run = await WorkflowRunner._get_run(db, run_id)
                run.status = "failed"
                run.error_message = str(e)
                await db.commit()
                raise

    @staticmethod
    async def resume(run_id: int, checkpoint: str, action: str):
        """Resume the pipeline after a human review checkpoint.
        This method is idempotent — calling it twice will NOT duplicate emails.
        """
        async with AsyncSessionLocal() as db:
            try:
                run = await WorkflowRunner._get_run(db, run_id)
                workflow = await WorkflowRunner._get_workflow(db, run.workflow_id)
                step_configs = await WorkflowRunner._get_step_configs(db, workflow.id)

                if checkpoint == "shortlist_review":
                    outreach_cfg = step_configs.get("outreach", {"enabled": True})
                    # Get approved candidates
                    approved_result = await db.execute(
                        select(Candidate).where(
                            Candidate.workflow_run_id == run_id,
                            Candidate.status == "approved",
                        )
                    )
                    approved = approved_result.scalars().all()

                    if not approved:
                        run.status = "completed"
                        run.current_step = "completed"
                        run.completed_at = datetime.now(timezone.utc)
                        await db.commit()
                        return

                    approved_ids = [c.id for c in approved]

                    # If outreach step is disabled, shortlist review is the terminal step.
                    if not outreach_cfg.get("enabled", True):
                        run.status = "completed"
                        run.current_step = "completed"
                        run.completed_at = datetime.now(timezone.utc)
                        await db.commit()
                        return

                    # ── Idempotency check ──────────────────────────────────────────
                    # If emails already exist for ANY of the approved candidates,
                    # skip generation and just ensure the run is at checkpoint_2.
                    existing_check = await db.execute(
                        select(OutreachEmail).where(
                            OutreachEmail.candidate_id.in_(approved_ids)
                        ).limit(1)
                    )
                    if existing_check.scalar_one_or_none() is not None:
                        # Emails already generated — just move to checkpoint_2
                        run.current_step = "checkpoint_2"
                        run.status = "waiting_review"
                        await db.commit()
                        return
                    # ──────────────────────────────────────────────────────────────

                    run.current_step = "outreach"
                    run.status = "running"
                    await db.commit()

                    outreach_cfg = step_configs.get("outreach", {})
                    outreach_agent = OutreachAgent()

                    candidates_data = [
                        {
                            "id": c.id,
                            "full_name": c.full_name,
                            "headline": c.headline,
                            "skills": c.skills,
                            "experience_years": c.experience_years,
                            "experience": c.experience,
                            "profile_summary": c.profile_summary,
                            "location": c.location,
                        }
                        for c in approved
                    ]
                    outreach_result = await outreach_agent.run({
                        "candidates": candidates_data,
                        "job_title": workflow.job_title,
                        "company_name": "Our Company",
                        "tone": outreach_cfg.get("tone", "friendly"),
                        "recruiter_name": "Recruitment Team",
                    })

                    for email_data in outreach_result["emails"]:
                        db.add(OutreachEmail(
                            candidate_id=email_data["candidate_id"],
                            subject=email_data.get("subject", ""),
                            body=email_data.get("body", ""),
                            tone=email_data.get("tone", "friendly"),
                            status="draft",
                        ))
                        db.add(CandidateEvent(
                            candidate_id=email_data["candidate_id"],
                            event_type="email_drafted",
                            agent="outreach_agent",
                            description="Personalised email draft generated",
                            event_metadata={"subject": email_data.get("subject")},
                        ))

                    run.current_step = "checkpoint_2"
                    run.status = "waiting_review"
                    await db.commit()

                elif checkpoint == "email_review":
                    scheduling_cfg = step_configs.get("scheduling", {"enabled": True})
                    if not scheduling_cfg.get("enabled", True):
                        run.status = "completed"
                        run.current_step = "completed"
                        run.completed_at = datetime.now(timezone.utc)
                        await db.commit()
                        return

                    sent_result = await db.execute(
                        select(OutreachEmail.id)
                        .join(Candidate, OutreachEmail.candidate_id == Candidate.id)
                        .where(
                            Candidate.workflow_run_id == run_id,
                            OutreachEmail.status.in_(["sent", "replied"]),
                        )
                        .limit(1)
                    )
                    has_sent = sent_result.scalar_one_or_none() is not None
                    run.current_step = "scheduling"
                    if has_sent:
                        run.status = "waiting_review"
                        run.completed_at = None
                    else:
                        run.status = "completed"
                        run.current_step = "completed"
                        run.completed_at = datetime.now(timezone.utc)
                    await db.commit()

            except Exception as e:
                run = await WorkflowRunner._get_run(db, run_id)
                run.status = "failed"
                run.error_message = str(e)
                await db.commit()
                raise

    @staticmethod
    async def delete_run(db: AsyncSession, run_id: int):
        """Delete a run and all its associated data (emails → events → candidates → run)."""
        # 1. Get all candidate IDs for this run
        cand_result = await db.execute(
            select(Candidate.id).where(Candidate.workflow_run_id == run_id)
        )
        candidate_ids = [row[0] for row in cand_result.all()]

        if candidate_ids:
            # 2. Delete outreach emails
            await db.execute(
                delete(OutreachEmail).where(OutreachEmail.candidate_id.in_(candidate_ids))
            )
            # 3. Delete candidate events
            await db.execute(
                delete(CandidateEvent).where(CandidateEvent.candidate_id.in_(candidate_ids))
            )
            # 4. Delete candidates
            await db.execute(
                delete(Candidate).where(Candidate.workflow_run_id == run_id)
            )

        # 5. Delete the run itself
        await db.execute(delete(WorkflowRun).where(WorkflowRun.id == run_id))
        await db.commit()

    @staticmethod
    async def clear_run_data(db: AsyncSession, run_id: int):
        """Delete generated data for a run while keeping the run record."""
        cand_result = await db.execute(
            select(Candidate.id).where(Candidate.workflow_run_id == run_id)
        )
        candidate_ids = [row[0] for row in cand_result.all()]

        if candidate_ids:
            await db.execute(
                delete(OutreachEmail).where(OutreachEmail.candidate_id.in_(candidate_ids))
            )
            await db.execute(
                delete(CandidateEvent).where(CandidateEvent.candidate_id.in_(candidate_ids))
            )

        await db.execute(
            delete(Candidate).where(Candidate.workflow_run_id == run_id)
        )

    @staticmethod
    async def regenerate(run_id: int):
        """Regenerate the same run in-place from the sourcing step."""
        async with AsyncSessionLocal() as db:
            run = await WorkflowRunner._get_run(db, run_id)
            await WorkflowRunner.clear_run_data(db, run_id)
            run.status = "pending"
            run.current_step = None
            run.error_message = None
            run.completed_at = None
            run.started_at = datetime.now(timezone.utc)
            run.state_data = {}
            await db.commit()

        await WorkflowRunner.execute(run_id)

    @staticmethod
    async def regenerate_step(run_id: int, step_name: str, skip_filtering: bool = False):
        """Regenerate a specific step for an existing run without restarting the full pipeline."""
        async with AsyncSessionLocal() as db:
            run = await WorkflowRunner._get_run(db, run_id)
            workflow = await WorkflowRunner._get_workflow(db, run.workflow_id)
            step_configs = await WorkflowRunner._get_step_configs(db, workflow.id)

            if step_name != "filtering":
                raise ValueError(f"Unsupported step for regeneration: {step_name}")

            run.status = "running"
            run.current_step = "filtering"
            run.error_message = None
            run.completed_at = None
            await db.commit()

            cand_result = await db.execute(
                select(Candidate).where(Candidate.workflow_run_id == run_id)
            )
            candidates = cand_result.scalars().all()
            if not candidates:
                raise ValueError("No sourced candidates found for this run")

            candidate_ids = [c.id for c in candidates]

            # Remove downstream outreach artifacts because shortlist is being regenerated.
            if candidate_ids:
                await db.execute(
                    delete(OutreachEmail).where(OutreachEmail.candidate_id.in_(candidate_ids))
                )
                await db.execute(
                    delete(CandidateEvent).where(
                        CandidateEvent.candidate_id.in_(candidate_ids),
                        CandidateEvent.event_type == "email_drafted",
                    )
                )
                await db.commit()

            filtering_cfg = step_configs.get("filtering", {"enabled": True})
            filtering_enabled = filtering_cfg.get("enabled", True) and not skip_filtering

            if not filtering_enabled:
                for cand in candidates:
                    cand.status = "filtered"
                    cand.recruiter_decision = None
                    cand.recruiter_score_override = None
                    cand.recruiter_notes = None
                    cand.filtered_at = datetime.now(timezone.utc)
                    db.add(CandidateEvent(
                        candidate_id=cand.id,
                        event_type="filtered",
                        agent="filtering_agent",
                        description="Filtering skipped; candidate moved to manual review",
                        event_metadata={"skipped": True},
                    ))
                await db.commit()
            else:
                filtering_agent = FilteringAgent()
                candidates_data = [
                    {
                        "id": c.id,
                        "full_name": c.full_name,
                        "headline": c.headline,
                        "skills": c.skills or [],
                        "experience_years": c.experience_years,
                        "experience": c.experience or [],
                        "education": c.education or [],
                        "profile_summary": c.profile_summary,
                        "profile_description": c.profile_description,
                        "location": c.location,
                    }
                    for c in candidates
                ]
                filter_result = await filtering_agent.run({
                    "candidates": candidates_data,
                    "job_title": workflow.job_title,
                    "job_description": workflow.job_description or "",
                    "required_skills": filtering_cfg.get("required_skills", []),
                    "preferred_skills": filtering_cfg.get("preferred_skills", []),
                    "strict_skill_match": filtering_cfg.get("strict_skill_match", False),
                    "min_experience_years": filtering_cfg.get("min_experience_years", 0),
                    "max_experience_years": filtering_cfg.get("max_experience_years"),
                    "min_score_threshold": filtering_cfg.get("min_score_threshold", 5.0),
                })
                min_score_threshold = float(filtering_cfg.get("min_score_threshold", 5.0))
                cand_by_id = {c.id: c for c in candidates}

                for scored in filter_result["candidates"]:
                    cand = cand_by_id.get(scored["id"])
                    if not cand:
                        continue
                    cand.ai_score = scored.get("ai_score")
                    cand.ai_score_reason = scored.get("ai_score_reason")
                    ai_status = scored.get("status", "filtered")
                    if cand.ai_score is not None and cand.ai_score < min_score_threshold:
                        ai_status = "rejected"
                    cand.status = ai_status
                    cand.recruiter_decision = None
                    cand.recruiter_score_override = None
                    cand.recruiter_notes = None
                    cand.filtered_at = datetime.now(timezone.utc)
                    db.add(CandidateEvent(
                        candidate_id=cand.id,
                        event_type="filtered",
                        agent="filtering_agent",
                        description=f"AI Score: {scored.get('ai_score', 0):.1f}/10",
                        event_metadata={
                            "score": scored.get("ai_score"),
                            "reason": scored.get("ai_score_reason"),
                            "regenerated": True,
                        },
                    ))
                await db.commit()

            run.current_step = "checkpoint_1"
            run.status = "waiting_review"
            await db.commit()

    @staticmethod
    async def _get_run(db: AsyncSession, run_id: int) -> WorkflowRun:
        result = await db.execute(select(WorkflowRun).where(WorkflowRun.id == run_id))
        return result.scalar_one()

    @staticmethod
    async def _get_workflow(db: AsyncSession, workflow_id: int) -> Workflow:
        result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
        return result.scalar_one()

    @staticmethod
    async def _get_step_configs(db: AsyncSession, workflow_id: int) -> dict:
        result = await db.execute(
            select(WorkflowStepConfig).where(WorkflowStepConfig.workflow_id == workflow_id)
        )
        configs = result.scalars().all()
        return {
            c.step_name: {
                "enabled": bool(c.enabled),
                **(c.config or {}),
            }
            for c in configs
        }

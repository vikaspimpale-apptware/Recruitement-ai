import httpx
import json
import re
from typing import Any
from datetime import datetime, timezone
from app.agents.base import BaseAgent
from app.core.config import settings


EXTRACTION_PROMPT = """You are a recruitment data extraction specialist. Extract structured profile data from the text below.

Return a JSON object with EXACTLY these fields (use null for missing values):
{
  "full_name": "string — candidate's full name",
  "headline": "string — current role/title from LinkedIn headline",
  "location": "string — city, country",
  "email": "string or null — email address if visible in the profile",
  "phone": "string or null — phone/contact number if visible in the profile",
  "current_company": "string or null — candidate's current company",
  "profile_description": "string or null — concise description/about section from the profile",
  "skills": ["array of skill strings"],
  "experience_years": number — total years of professional experience (estimate from dates),
  "experience": [{"title": "...", "company": "...", "duration": "...", "description": "..."}],
  "education": [{"degree": "...", "institution": "...", "year": number_or_null}],
  "profile_summary": "2-3 sentence professional summary based on their full career",
  "resume_url": "string or null — external resume/CV URL if explicitly present in profile text"
}

Rules:
- Extract ALL experience entries, not just the most recent ones
- If you cannot determine the full name, use the URL slug (e.g. "john-smith" → "John Smith")
- Skills must be extracted from the text; infer from job titles if not explicit
- experience_years must be a number (0 if unknown)
- email and phone are usually private on LinkedIn — set to null if not visible
- current_company should match the most recent experience entry if possible
- Return ONLY valid JSON, no markdown, no explanation
"""


class SourcingAgent(BaseAgent):
    name = "sourcing_agent"
    DEFAULT_TEST_PROFILE_URL = "https://www.linkedin.com/in/vikas-pimpale-b27b38129/"

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        """Search LinkedIn-indexed profiles via Exa API and extract structured data."""
        job_title = context.get("job_title", "")
        job_description = context.get("job_description", "")
        location = context.get("location", "")
        seniority = context.get("seniority", "")
        keywords = context.get("keywords", [])
        max_candidates = context.get("max_candidates", 20)
        min_candidates = max(1, int(context.get("min_candidates", 25)))
        include_test_profile = bool(context.get("include_test_profile", True))

        self._log(f"Sourcing {seniority} {job_title} in {location}")

        raw_profiles = await self._search_linkedin(
            job_title, job_description, location, seniority, keywords, max_candidates
        )
        self._log(f"Raw results from Exa: {len(raw_profiles)}")

        if len(raw_profiles) < min_candidates:
            missing = min_candidates - len(raw_profiles)
            self._log(f"Only {len(raw_profiles)} profiles found. Appending {missing} fallback profiles.")
            fallback = self._mock_profiles(job_title, location, max(missing, max_candidates))
            existing_urls = {p.get("url") or p.get("linkedin_url") for p in raw_profiles}
            for profile in fallback:
                if len(raw_profiles) >= min_candidates:
                    break
                profile_url = profile.get("url") or profile.get("linkedin_url")
                if profile_url in existing_urls:
                    continue
                raw_profiles.append(profile)
                existing_urls.add(profile_url)

        raw_profiles = self._dedupe_raw_profiles(raw_profiles)

        structured = await self._structure_profiles(raw_profiles, job_title)
        structured = self._dedupe_structured_profiles(structured)
        self._log(f"Structured profiles: {len(structured)}")

        if include_test_profile:
            test_profile = self._build_test_profile(job_title, location)
            test_url = test_profile.get("linkedin_url")
            already_present = any((c.get("linkedin_url") or "").strip().lower() == test_url.lower() for c in structured)
            if not already_present:
                structured.insert(0, test_profile)
                self._log("Injected default test profile for email verification.")

        if len(structured) < min_candidates:
            needed = min_candidates - len(structured)
            extra = self._mock_profiles(job_title, location, needed + 5)
            existing_urls = {self._normalize_linkedin_url(c.get("linkedin_url")) for c in structured}
            existing_keys = {self._identity_key(c) for c in structured}
            for profile in extra:
                if len(structured) >= min_candidates:
                    break
                profile_url = self._normalize_linkedin_url(profile.get("linkedin_url"))
                profile_key = self._identity_key(profile)
                if profile_url in existing_urls or profile_key in existing_keys:
                    continue
                structured.append(profile)
                existing_urls.add(profile_url)
                existing_keys.add(profile_key)

        structured = self._dedupe_structured_profiles(structured)

        return {
            "candidates": structured,
            "sourced_at": datetime.now(timezone.utc).isoformat(),
            "total_found": len(structured),
            "source": "exa_linkedin" if settings.EXA_API_KEY else "mock",
        }

    def _normalize_linkedin_url(self, url: str | None) -> str:
        if not url:
            return ""
        cleaned = url.strip().lower()
        cleaned = re.sub(r"^https?://(www\.)?", "", cleaned)
        cleaned = cleaned.rstrip("/")
        return cleaned

    def _normalize_text(self, value: str | None) -> str:
        if not value:
            return ""
        return re.sub(r"\s+", " ", str(value).strip().lower())

    def _normalize_phone(self, phone: str | None) -> str:
        if not phone:
            return ""
        return re.sub(r"\D", "", phone)

    def _identity_key(self, profile: dict[str, Any]) -> str:
        email = self._normalize_text(profile.get("email"))
        if email:
            return f"email:{email}"
        phone = self._normalize_phone(profile.get("phone"))
        if len(phone) >= 8:
            return f"phone:{phone}"
        url = self._normalize_linkedin_url(profile.get("linkedin_url") or profile.get("url"))
        if url:
            return f"url:{url}"
        name = self._normalize_text(profile.get("full_name"))
        company = self._normalize_text(profile.get("current_company"))
        return f"name_company:{name}|{company}"

    def _profile_quality_score(self, profile: dict[str, Any]) -> int:
        score = 0
        if self._normalize_text(profile.get("full_name")):
            score += 3
        if self._normalize_text(profile.get("headline")):
            score += 2
        if self._normalize_text(profile.get("location")):
            score += 1
        if self._normalize_text(profile.get("email")):
            score += 2
        if self._normalize_phone(profile.get("phone")):
            score += 1
        if self._normalize_text(profile.get("current_company")):
            score += 2
        if self._normalize_text(profile.get("profile_description")):
            score += 2
        skills = profile.get("skills") or []
        if isinstance(skills, list):
            score += min(3, len(skills))
        exp = profile.get("experience") or []
        if isinstance(exp, list):
            score += min(3, len(exp))
        return score

    def _dedupe_raw_profiles(self, profiles: list[dict[str, Any]]) -> list[dict[str, Any]]:
        best_by_key: dict[str, dict[str, Any]] = {}
        for profile in profiles:
            key = self._identity_key(profile)
            if not key:
                continue
            prev = best_by_key.get(key)
            if prev is None or self._profile_quality_score(profile) > self._profile_quality_score(prev):
                best_by_key[key] = profile
        return list(best_by_key.values())

    def _dedupe_structured_profiles(self, profiles: list[dict[str, Any]]) -> list[dict[str, Any]]:
        best_by_key: dict[str, dict[str, Any]] = {}
        for profile in profiles:
            key = self._identity_key(profile)
            if not key:
                continue
            prev = best_by_key.get(key)
            if prev is None or self._profile_quality_score(profile) > self._profile_quality_score(prev):
                best_by_key[key] = profile

        ordered = list(best_by_key.values())
        ordered.sort(key=self._profile_quality_score, reverse=True)
        return ordered

    async def _search_linkedin(
        self,
        job_title: str,
        job_description: str,
        location: str,
        seniority: str,
        keywords: list[str],
        max_candidates: int,
    ) -> list[dict]:
        """Use Exa API to search LinkedIn profiles with an optimised query."""
        if not settings.EXA_API_KEY:
            self._log("EXA_API_KEY not set — using mock data")
            return self._mock_profiles(job_title, location, max_candidates)

        # Build a precise Exa query targeting LinkedIn /in/ profiles
        keyword_str = " ".join(keywords) if keywords else job_title
        jd_hint = " ".join((job_description or "").split()[:25])
        query = f'{seniority} {job_title} {location} {keyword_str} {jd_hint} open to work LinkedIn profile'

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                payload = {
                    "query": query,
                    "numResults": min(max(max_candidates * 3, 50), 100),
                    "type": "neural",
                    "includeDomains": ["linkedin.com"],
                    "contents": {
                        "text": {"maxCharacters": 7000},
                        "highlights": {"numSentences": 5, "highlightsPerUrl": 3},
                    },
                }
                response = await client.post(
                    "https://api.exa.ai/search",
                    headers={"x-api-key": settings.EXA_API_KEY, "Content-Type": "application/json"},
                    json=payload,
                )
                response.raise_for_status()
                results = response.json().get("results", [])

                # Filter to only /in/ profile pages
                profile_results = [
                    r for r in results
                    if "linkedin.com/in/" in r.get("url", "")
                ]
                self._log(f"Exa returned {len(results)} results, {len(profile_results)} are /in/ profiles")

                if not profile_results:
                    self._log("No LinkedIn /in/ profiles found — falling back to mock data")
                    return self._mock_profiles(job_title, location, max_candidates)

                return profile_results

        except httpx.HTTPStatusError as e:
            self._log(f"Exa API HTTP error {e.response.status_code}: {e.response.text[:200]}")
            return self._mock_profiles(job_title, location, max_candidates)
        except Exception as e:
            self._log(f"Exa API error: {e} — falling back to mock data")
            return self._mock_profiles(job_title, location, max_candidates)

    async def _structure_profiles(self, raw_profiles: list[dict], job_title: str) -> list[dict]:
        """Extract structured data from Exa results using LLM."""
        structured = []

        for profile in raw_profiles:
            # Mock data already has full_name
            if "full_name" in profile:
                structured.append(profile)
                continue

            url = profile.get("url", "")
            title = profile.get("title", "")
            text = profile.get("text", "") or ""
            highlights = profile.get("highlights", [])

            # Build the richest possible input for the LLM
            content_parts = []
            if title:
                content_parts.append(f"Page Title: {title}")
            if highlights:
                content_parts.append("Key excerpts:\n" + "\n".join(highlights[:5]))
            if text:
                content_parts.append(f"Profile text:\n{text[:2500]}")

            if not content_parts:
                self._log(f"No content for {url}, skipping")
                continue

            combined_text = "\n\n".join(content_parts)

            # Extract name from URL as a hint
            url_name_hint = ""
            match = re.search(r"linkedin\.com/in/([^/?]+)", url)
            if match:
                slug = match.group(1).split("-")[:-1] if match.group(1)[-1].isdigit() else match.group(1).split("-")
                url_name_hint = " ".join(w.capitalize() for w in slug[:3])

            prompt_extra = f"\nURL: {url}"
            if url_name_hint:
                prompt_extra += f"\nURL name hint (may be the person's name): {url_name_hint}"

            from langchain_core.messages import HumanMessage, SystemMessage
            messages = [
                SystemMessage(content=EXTRACTION_PROMPT),
                HumanMessage(content=prompt_extra + "\n\n" + combined_text),
            ]

            try:
                result = await self.llm.ainvoke(messages)
                raw_content = result.content.strip()

                # Strip markdown code fences if LLM adds them
                raw_content = re.sub(r"^```(?:json)?\s*", "", raw_content)
                raw_content = re.sub(r"\s*```$", "", raw_content)

                data = json.loads(raw_content)
                data["linkedin_url"] = url

                # Ensure required fields have defaults
                data.setdefault("full_name", url_name_hint or "Unknown Candidate")
                data.setdefault("skills", [])
                data.setdefault("experience", [])
                data.setdefault("education", [])
                data.setdefault("experience_years", 0)
                data.setdefault("email", None)
                data.setdefault("phone", None)
                data.setdefault("current_company", None)
                data.setdefault("profile_description", None)
                data.setdefault("resume_url", None)

                if not data.get("current_company") and isinstance(data.get("experience"), list) and data["experience"]:
                    first_role = data["experience"][0]
                    if isinstance(first_role, dict):
                        data["current_company"] = first_role.get("company")

                inferred = self._infer_from_raw(title, text, url_name_hint)
                data["location"] = data.get("location") or inferred["location"]
                data["email"] = data.get("email") or inferred["email"]
                data["phone"] = data.get("phone") or inferred["phone"]
                data["resume_url"] = data.get("resume_url") or inferred["resume_url"]
                data["current_company"] = data.get("current_company") or inferred["current_company"]
                if not data.get("skills"):
                    data["skills"] = inferred["skills"]
                if not data.get("profile_description"):
                    data["profile_description"] = inferred["profile_description"]
                if not data.get("profile_summary"):
                    data["profile_summary"] = inferred["profile_summary"]

                # Ensure experience_years is a number
                if not isinstance(data["experience_years"], (int, float)):
                    try:
                        data["experience_years"] = float(str(data["experience_years"]).replace("+", ""))
                    except (ValueError, TypeError):
                        data["experience_years"] = 0
                if data["experience_years"] == 0:
                    data["experience_years"] = self._infer_experience_years(title + " " + text)

                if self._is_profile_valid(data):
                    structured.append(data)
                    self._log(f"Extracted: {data['full_name']} — {data.get('headline', '')[:60]}")

            except json.JSONDecodeError as e:
                self._log(f"JSON parse failed for {url}: {e} — using URL-derived fallback")
                fallback = self._fallback_profile(url, title, text, url_name_hint, job_title)
                if self._is_profile_valid(fallback):
                    structured.append(fallback)
            except Exception as e:
                self._log(f"LLM extraction failed for {url}: {e}")
                fallback = self._fallback_profile(url, title, text, url_name_hint, job_title)
                if self._is_profile_valid(fallback):
                    structured.append(fallback)

        return structured

    def _is_profile_valid(self, profile: dict[str, Any]) -> bool:
        full_name = self._normalize_text(profile.get("full_name"))
        headline = self._normalize_text(profile.get("headline"))
        skills = profile.get("skills") or []
        linkedin = self._normalize_linkedin_url(profile.get("linkedin_url") or profile.get("url"))
        if not full_name or full_name in {"unknown candidate", "linkedin candidate"}:
            return False
        if not linkedin:
            return False
        if not headline and not skills:
            return False
        return True

    def _fallback_profile(self, url: str, title: str, raw_text: str, name_hint: str, job_title: str) -> dict:
        """Create a minimal profile when LLM extraction fails."""
        inferred = self._infer_from_raw(title, raw_text, name_hint)
        return {
            "full_name": name_hint or "LinkedIn Candidate",
            "headline": title or job_title,
            "linkedin_url": url,
            "location": inferred["location"] or "Unknown",
            "email": inferred["email"],
            "phone": inferred["phone"],
            "current_company": inferred["current_company"],
            "profile_description": inferred["profile_description"] or title or job_title,
            "skills": inferred["skills"],
            "experience_years": self._infer_experience_years(title + " " + raw_text),
            "experience": [],
            "education": [],
            "profile_summary": inferred["profile_summary"] or "Profile sourced from LinkedIn. Manual review recommended.",
            "resume_url": inferred["resume_url"],
        }

    def _infer_from_raw(self, title: str, text: str, name_hint: str) -> dict[str, Any]:
        blob = f"{title}\n{text}"
        email_match = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", blob)
        phone_match = re.search(r"(\+?\d[\d\s\-()]{8,}\d)", blob)
        resume_match = re.search(r"https?://[^\s]+(?:resume|cv|curriculum|drive\.google|dropbox)[^\s]*", blob, flags=re.I)
        location_match = re.search(r"(?:Location|Based in|Lives in)\s*[:\-]\s*([A-Za-z ,]+)", blob, flags=re.I)

        return {
            "email": email_match.group(0) if email_match else None,
            "phone": phone_match.group(0).strip() if phone_match else None,
            "resume_url": resume_match.group(0) if resume_match else None,
            "location": location_match.group(1).strip() if location_match else None,
            "current_company": self._infer_current_company(title),
            "skills": self._infer_skills(title + " " + text),
            "profile_description": title.strip() if title else None,
            "profile_summary": f"{name_hint or 'Candidate'} profile sourced from LinkedIn search results.",
        }

    def _infer_current_company(self, title: str) -> str | None:
        match = re.search(r"(?: at | @ )([A-Za-z0-9&.\- ]{2,})", title, flags=re.I)
        if not match:
            return None
        company = match.group(1).strip(" -|")
        return company[:120] if company else None

    def _infer_experience_years(self, text: str) -> float:
        # Capture patterns like "8 years", "7+ yrs", etc.
        matches = re.findall(r"(\d{1,2}(?:\.\d+)?)\s*(?:\+?\s*)?(?:years|yrs|year)\b", text, flags=re.I)
        values = []
        for m in matches:
            try:
                values.append(float(m))
            except ValueError:
                pass
        return max(values) if values else 0.0

    def _infer_skills(self, text: str) -> list[str]:
        known = [
            "python", "java", "javascript", "typescript", "react", "node.js", "node",
            "spring boot", "spring", "docker", "kubernetes", "aws", "azure", "gcp",
            "fastapi", "django", "flask", "sql", "postgresql", "mysql", "mongodb",
            "redis", "langchain", "gen ai", "ai", "machine learning", "c++", "swift",
        ]
        text_l = text.lower()
        found = [s for s in known if s in text_l]
        pretty = []
        for s in found:
            pretty.append(s.upper() if len(s) <= 3 else s.title())
        return pretty[:20]

    def _mock_profiles(self, job_title: str, location: str, count: int) -> list[dict]:
        """Realistic mock profiles — used when EXA_API_KEY is not set or Exa fails."""
        import random
        candidates = [
            {
                "full_name": "Arjun Sharma",
                "headline": f"Senior {job_title} | Python · LangChain · AWS | Open to Work",
                "location": location,
                "email": "arjun.sharma@gmail.com",
                "phone": "+91 98765 43210",
                "current_company": "TechMahindra",
                "profile_description": "Senior backend engineer focused on AI-powered recruitment systems, distributed APIs, and cloud architecture.",
                "skills": ["Python", "FastAPI", "LangChain", "PostgreSQL", "Docker", "AWS", "Redis"],
                "experience_years": 7.5,
                "experience": [
                    {"title": f"Senior {job_title}", "company": "TechMahindra", "duration": "Jan 2021 – Present (3 yrs)", "description": "Led backend architecture for ML-powered recruitment and HR-tech products. Designed microservices handling 50K+ daily requests."},
                    {"title": "Software Engineer", "company": "Infosys", "duration": "Jul 2016 – Dec 2020 (4.5 yrs)", "description": "Developed RESTful APIs, data pipelines, and ETL workflows for enterprise clients in banking and logistics."},
                ],
                "education": [{"degree": "B.Tech Computer Science", "institution": "IIT Bombay", "year": 2016}],
                "profile_summary": f"Arjun is a senior {job_title} with 7.5 years building scalable backend systems. Specialises in Python, FastAPI, and LangChain-based AI applications. Currently open to new opportunities in {location}.",
                "resume_url": "https://example.com/resume/arjun-sharma.pdf",
            },
            {
                "full_name": "Priya Patel",
                "headline": f"Full Stack Engineer | React · Node.js · TypeScript | {location}",
                "location": location,
                "email": "priya.patel@outlook.com",
                "phone": "+91 87654 32109",
                "current_company": "Flipkart",
                "profile_description": "Full-stack engineer with strong product ownership across consumer web features and high-traffic interfaces.",
                "skills": ["React", "TypeScript", "Node.js", "GraphQL", "MongoDB", "AWS", "Docker"],
                "experience_years": 5.0,
                "experience": [
                    {"title": "Full Stack Developer", "company": "Flipkart", "duration": "Aug 2021 – Present (2.5 yrs)", "description": "Built consumer-facing product features including search, cart, and checkout for 400M+ user platform."},
                    {"title": "Frontend Engineer", "company": "Wipro", "duration": "Jul 2019 – Jul 2021 (2 yrs)", "description": "React SPA development for US financial services clients. Implemented complex state management with Redux."},
                ],
                "education": [{"degree": "B.E. Information Technology", "institution": "NIT Surat", "year": 2019}],
                "profile_summary": f"Priya is a full-stack engineer with 5 years of experience across React and Node.js ecosystems. Strong in TypeScript, GraphQL, and cloud-native deployments. Open to work in {location}.",
                "resume_url": None,
            },
            {
                "full_name": "Rahul Mehta",
                "headline": "ML Engineer | LLMs · PyTorch · MLOps | Open to Work",
                "location": location,
                "email": "rahul.mehta@proton.me",
                "phone": "+91 99887 76655",
                "current_company": "Zomato",
                "profile_description": "Machine learning engineer specialising in ranking, recommendations, and production-ready LLM systems.",
                "skills": ["Python", "PyTorch", "TensorFlow", "MLflow", "Kubernetes", "LangChain", "OpenAI API"],
                "experience_years": 6.0,
                "experience": [
                    {"title": "ML Engineer", "company": "Zomato", "duration": "Mar 2021 – Present (3 yrs)", "description": "Built recommendation and ranking models for food discovery. Reduced model inference latency by 40% via quantisation."},
                    {"title": "Data Scientist", "company": "Accenture", "duration": "Jun 2018 – Feb 2021 (2.8 yrs)", "description": "NLP and classification pipelines for retail and BFSI clients. Deployed 12 models to production."},
                ],
                "education": [{"degree": "M.Tech AI & ML", "institution": "IIT Hyderabad", "year": 2018}],
                "profile_summary": "Rahul specialises in LLM fine-tuning, RAG pipelines, and MLOps. 6 years building AI products in consumer-tech and consulting. Currently exploring GenAI engineering roles.",
                "resume_url": None,
            },
            {
                "full_name": "Sneha Joshi",
                "headline": f"Backend Engineer | FastAPI · PostgreSQL · Microservices | {location}",
                "location": location,
                "email": "sneha.joshi@gmail.com",
                "phone": "+91 76543 21098",
                "current_company": "Razorpay",
                "profile_description": "Backend engineer with fintech experience designing reliable, high-throughput APIs and event-driven services.",
                "skills": ["Python", "FastAPI", "SQLAlchemy", "PostgreSQL", "RabbitMQ", "Celery", "Redis"],
                "experience_years": 4.0,
                "experience": [
                    {"title": "Backend Engineer", "company": "Razorpay", "duration": "Apr 2022 – Present (2 yrs)", "description": "Payment gateway microservices processing ₹5000 Cr+ monthly. Built idempotency and retry mechanisms for critical payment flows."},
                    {"title": "Software Developer", "company": "Mphasis", "duration": "Jun 2020 – Mar 2022 (1.9 yrs)", "description": "Enterprise API development for insurance and banking domain. Worked on claims processing automation."},
                ],
                "education": [{"degree": "B.Tech CSE", "institution": "VIT Vellore", "year": 2020}],
                "profile_summary": "Sneha builds high-throughput backend systems with strong FastAPI and PostgreSQL expertise. Experienced in fintech with focus on reliability and idempotency. Currently open to senior backend roles.",
                "resume_url": None,
            },
            {
                "full_name": "Amit Kumar",
                "headline": "DevOps / Platform Engineer | Kubernetes · Terraform · CI/CD",
                "location": location,
                "email": "amit.kumar.devops@gmail.com",
                "phone": "+91 88776 65544",
                "current_company": "PhonePe",
                "profile_description": "Platform and DevOps engineer focused on Kubernetes reliability, cloud cost optimization, and CI/CD automation.",
                "skills": ["Kubernetes", "Terraform", "AWS", "GCP", "GitHub Actions", "ArgoCD", "Prometheus"],
                "experience_years": 8.0,
                "experience": [
                    {"title": "Senior Platform Engineer", "company": "PhonePe", "duration": "Jan 2020 – Present (4 yrs)", "description": "Managed Kubernetes infrastructure for 100M+ user platform. Reduced cloud costs by 28% via spot instance optimisation."},
                    {"title": "DevOps Engineer", "company": "HCL Technologies", "duration": "Aug 2016 – Dec 2019 (3.4 yrs)", "description": "Cloud migration (on-prem to AWS/GCP) and CI/CD pipeline automation for Fortune 500 clients."},
                ],
                "education": [{"degree": "B.E. Electronics", "institution": "Anna University", "year": 2016}],
                "profile_summary": "Amit has 8 years of DevOps and platform engineering experience. Expert in cloud-native infrastructure, GitOps, and cost optimisation at scale. Seeking senior/staff platform roles.",
                "resume_url": None,
            },
            {
                "full_name": "Divya Singh",
                "headline": f"Software Engineer | Python · Django · REST APIs | Open to Work | {location}",
                "location": location,
                "email": "divya.singh.dev@gmail.com",
                "phone": "+91 99001 12233",
                "current_company": "Urban Company",
                "profile_description": "Python backend developer building scalable service-booking and transaction APIs with strong reliability focus.",
                "skills": ["Python", "Django", "DRF", "MySQL", "Celery", "Redis", "Docker"],
                "experience_years": 3.5,
                "experience": [
                    {"title": "Software Engineer", "company": "Urban Company", "duration": "Jan 2022 – Present (2 yrs)", "description": "Built service-booking backend APIs serving 2M+ monthly transactions. Owned the ratings and review microservice end-to-end."},
                    {"title": "Junior Developer", "company": "Persistent Systems", "duration": "Jul 2020 – Dec 2021 (1.5 yrs)", "description": "Python microservices development for US healthcare client. REST API design and integration testing."},
                ],
                "education": [{"degree": "B.Sc Computer Science", "institution": "Delhi University", "year": 2020}],
                "profile_summary": "Divya is a Python backend developer with 3.5 years experience in Django and REST APIs. Currently seeking senior software engineer roles with high-growth startups in {location}.".format(location=location),
                "resume_url": None,
            },
            {
                "full_name": "Rohan Verma",
                "headline": "Senior Software Architect | Java · Spring Boot · System Design",
                "location": location,
                "email": "rohan.verma.arch@gmail.com",
                "phone": "+91 77889 90011",
                "current_company": "Paytm",
                "profile_description": "Software architect with extensive fintech background in distributed systems and event-driven architecture.",
                "skills": ["Java", "Spring Boot", "Kafka", "Cassandra", "Microservices", "AWS", "Design Patterns"],
                "experience_years": 10.0,
                "experience": [
                    {"title": "Software Architect", "company": "Paytm", "duration": "Apr 2019 – Present (5 yrs)", "description": "Designed distributed payment systems handling 10M+ daily transactions. Led architectural review board and drove adoption of event-driven patterns."},
                    {"title": "Senior Engineer", "company": "Oracle", "duration": "Jun 2014 – Mar 2019 (4.8 yrs)", "description": "Enterprise Java applications for financial services. Core contributor to Oracle FLEXCUBE retail banking product."},
                ],
                "education": [{"degree": "B.Tech Computer Engineering", "institution": "BITS Pilani", "year": 2014}],
                "profile_summary": "Rohan is a seasoned software architect with 10 years designing high-scale distributed systems in fintech. Strong expertise in Java ecosystem, event-driven architecture, and technical leadership. Looking for VP/Tech Lead opportunities.",
                "resume_url": None,
            },
            {
                "full_name": "Neha Gupta",
                "headline": "AI/GenAI Engineer | LangChain · RAG · Vector DBs | Open to Work",
                "location": location,
                "email": "neha.gupta.ai@gmail.com",
                "phone": "+91 90123 45678",
                "current_company": "Myntra",
                "profile_description": "GenAI engineer building RAG systems, LLM agents, and retrieval pipelines for production consumer products.",
                "skills": ["Python", "LangChain", "LangGraph", "OpenAI", "Pinecone", "Weaviate", "FastAPI"],
                "experience_years": 4.5,
                "experience": [
                    {"title": "GenAI Engineer", "company": "Myntra", "duration": "Sep 2022 – Present (1.5 yrs)", "description": "Built RAG-based fashion product recommendation and visual search. Improved recommendation CTR by 22% using hybrid search."},
                    {"title": "ML Engineer", "company": "Amazon", "duration": "Jun 2019 – Aug 2022 (3.2 yrs)", "description": "Ranking and retrieval systems for Amazon India search. Worked on A/B testing framework and feature engineering at petabyte scale."},
                ],
                "education": [{"degree": "M.Sc Data Science", "institution": "ISI Kolkata", "year": 2019}],
                "profile_summary": "Neha specialises in GenAI and LLM application development. 4.5 years experience with RAG pipelines, agents, and vector databases. Passionate about building production-grade AI systems.",
                "resume_url": None,
            },
            {
                "full_name": "Vikram Rao",
                "headline": f"Engineering Manager | Team Lead | Python · Go · Distributed Systems | {location}",
                "location": location,
                "email": "vikram.rao.em@gmail.com",
                "phone": "+91 98001 23456",
                "current_company": "CRED",
                "profile_description": "Engineering manager with a track record of delivering large-scale distributed systems and mentoring strong teams.",
                "skills": ["Python", "Go", "System Design", "Team Leadership", "Agile", "AWS", "gRPC"],
                "experience_years": 12.0,
                "experience": [
                    {"title": "Engineering Manager", "company": "CRED", "duration": "Jan 2021 – Present (3 yrs)", "description": "Led team of 12 engineers building fintech platform. Delivered 4 major product initiatives. Reduced deployment cycle time from 2 weeks to 2 days."},
                    {"title": "Staff Engineer", "company": "Swiggy", "duration": "Mar 2017 – Dec 2020 (3.8 yrs)", "description": "Core infrastructure team. Designed the order management and dispatch system powering 3M+ daily orders."},
                    {"title": "Senior Software Engineer", "company": "Thoughtworks", "duration": "Jul 2012 – Feb 2017 (4.7 yrs)", "description": "Full-stack consulting across retail, insurance, and media clients. Championed agile practices and TDD culture."},
                ],
                "education": [{"degree": "B.Tech CSE", "institution": "NIT Trichy", "year": 2012}],
                "profile_summary": "Vikram is an engineering manager with 12 years experience leading high-performing teams and building large-scale distributed systems. Proven track record of growing engineers and shipping complex products on time. Open to Head of Engineering / Director roles.",
                "resume_url": None,
            },
            {
                "full_name": "Anjali Mishra",
                "headline": "Data Engineer | PySpark · Airflow · Snowflake | Open to Work",
                "location": location,
                "email": "anjali.mishra.data@gmail.com",
                "phone": "+91 86754 32190",
                "current_company": "BigBasket",
                "profile_description": "Data engineer specializing in ETL modernization, real-time pipelines, and cloud data warehouse optimization.",
                "skills": ["PySpark", "Apache Airflow", "Snowflake", "dbt", "Python", "AWS Glue", "Kafka"],
                "experience_years": 5.5,
                "experience": [
                    {"title": "Senior Data Engineer", "company": "BigBasket", "duration": "May 2021 – Present (3 yrs)", "description": "Built real-time data pipelines for inventory management and demand forecasting. Migrated legacy Hadoop jobs to PySpark, reducing processing time by 60%."},
                    {"title": "Data Engineer", "company": "Mu Sigma", "duration": "Jul 2018 – Apr 2021 (2.8 yrs)", "description": "Analytics data warehousing and ETL development for FMCG and retail clients. Introduced dbt for transformation layer standardisation."},
                ],
                "education": [{"degree": "B.Tech Information Technology", "institution": "SRM University", "year": 2018}],
                "profile_summary": "Anjali is a data engineer with strong ETL, streaming pipeline, and cloud data warehouse expertise. 5.5 years across e-commerce and analytics consulting. Comfortable with the full modern data stack.",
                "resume_url": None,
            },
            {
                "full_name": "Karan Nair",
                "headline": "Frontend Lead | React · Next.js · Performance | Open to Work",
                "location": location,
                "email": "karan.nair.fe@gmail.com",
                "phone": "+91 79123 45670",
                "current_company": "Meesho",
                "profile_description": "Frontend lead focused on high-performance React applications, design systems, and web accessibility.",
                "skills": ["React", "Next.js", "TypeScript", "Webpack", "Performance Optimisation", "Tailwind CSS", "Jest"],
                "experience_years": 6.5,
                "experience": [
                    {"title": "Frontend Lead", "company": "Meesho", "duration": "Jun 2020 – Present (3.5 yrs)", "description": "Led front-end team of 6 for 50M+ user social commerce app. Improved Core Web Vitals LCP from 4.5s to 1.8s. Owned design system and component library."},
                    {"title": "UI Engineer", "company": "Mindtree", "duration": "Jul 2017 – May 2020 (2.9 yrs)", "description": "Enterprise web applications for US insurance and logistics clients. Delivered 3 large Angular-to-React migration projects."},
                ],
                "education": [{"degree": "B.Sc Computer Science", "institution": "Pune University", "year": 2017}],
                "profile_summary": "Karan leads frontend teams with deep React and performance engineering expertise. 6.5 years building scalable consumer UIs with strong focus on Web Vitals, accessibility, and design systems.",
                "resume_url": None,
            },
            {
                "full_name": "Pooja Reddy",
                "headline": "QA / SDET Engineer | Selenium · Cypress · API Testing | Open to Work",
                "location": location,
                "email": "pooja.reddy.qa@gmail.com",
                "phone": "+91 91234 56789",
                "current_company": "Freshworks",
                "profile_description": "SDET engineer with end-to-end ownership of test automation strategy for web, API, and performance testing.",
                "skills": ["Selenium", "Cypress", "Pytest", "Postman", "JMeter", "Python", "CI/CD"],
                "experience_years": 4.0,
                "experience": [
                    {"title": "SDET", "company": "Freshworks", "duration": "Mar 2022 – Present (2 yrs)", "description": "Automated test suites for CRM and ITSM products. Achieved 85% automation coverage. Integrated tests into GitHub Actions CI/CD pipeline."},
                    {"title": "QA Engineer", "company": "Cognizant", "duration": "Jun 2020 – Feb 2022 (1.7 yrs)", "description": "Manual and automation testing for a major UK retail bank's digital platform. Load testing with JMeter for peak traffic scenarios."},
                ],
                "education": [{"degree": "B.Tech CSE", "institution": "Osmania University", "year": 2020}],
                "profile_summary": "Pooja is a senior QA/SDET with expertise in test automation frameworks for web and API testing. 4 years across SaaS and enterprise banking products with strong CI/CD integration skills.",
                "resume_url": None,
            },
        ]

        # Randomise slightly so each run is different
        random.shuffle(candidates)
        result = [dict(c) for c in candidates]

        # Expand pool deterministically if requested count exceeds seed list
        if count > len(result):
            base = [dict(c) for c in result]
            idx = 0
            while len(result) < count:
                src = dict(base[idx % len(base)])
                idx += 1
                src["full_name"] = f"{src['full_name']} {idx}"
                src["email"] = f"candidate{idx}@demo.local"
                src["phone"] = f"+919{idx % 1000000000:09d}"
                result.append(src)

        result = result[:count]

        # Add a unique LinkedIn URL to each
        for i, c in enumerate(result):
            slug = c["full_name"].lower().replace(" ", "-")
            c["linkedin_url"] = f"https://linkedin.com/in/{slug}-{random.randint(100, 999)}"
            c.setdefault("email", None)
            c.setdefault("phone", None)

        return result

    def _build_test_profile(self, job_title: str, location: str) -> dict[str, Any]:
        """Inject a deterministic testing profile for validating outreach flow."""
        return {
            "full_name": "Vikas Pimpale (Test Profile)",
            "headline": f"Test Candidate for {job_title} workflow validation",
            "linkedin_url": self.DEFAULT_TEST_PROFILE_URL,
            "location": location or "India",
            "email": "vickspimple143@gmail.com",
            "phone": "+91 90000 00000",
            "current_company": "Testing Profile",
            "profile_description": "Synthetic profile auto-injected for workflow/email verification.",
            "skills": ["Testing", "Recruitment Workflow", "Validation"],
            "experience_years": 6.0,
            "experience": [
                {
                    "title": "QA Engineer",
                    "company": "Demo Corp",
                    "duration": "2019 - Present",
                    "description": "Validates recruitment and outreach systems end-to-end.",
                }
            ],
            "education": [],
            "profile_summary": "This profile is added by default for testing sourcing, filtering, and outreach flows.",
            "resume_url": None,
        }

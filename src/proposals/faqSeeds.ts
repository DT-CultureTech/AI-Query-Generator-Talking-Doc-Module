/**
 * Manually curated seed FAQs derived from the three proposal documents.
 * These are loaded once on first startup (when faq_cache is empty).
 *
 * 6 FAQs for Integrated Spaces Ltd
 * 7 FAQs for Munchable.tv
 * 6 FAQs for Unique International
 */

export interface SeedFaq {
  question: string;
  answer: string;
  sourceFile: string;
}

export const SEED_FAQS: SeedFaq[] = [

  // ── Integrated Spaces Ltd Proposal.md ──────────────────────────────────────

  {
    question: "What is the main deliverable for Integrated Spaces Ltd?",
    answer:
      "The main deliverable is the DT Blueprint — a 2-week engagement that produces a step-by-step Practical Sales Manual. The manual allows the Integrated Spaces founder to stop being the only salesperson and instead manage a documented, repeatable sales process that can be handed to a new hire.",
    sourceFile: "Integrated Spaces Ltd Proposal.md"
  },
  {
    question: "What is the timeline for the Integrated Spaces project?",
    answer:
      "The project runs for 14 days across two phases. Phase 1 (Days 1–7) — Removing the Guesswork: defining the exact target customer, creating a qualification checklist, and mapping the 4–5 step lead-to-customer funnel. Phase 2 (Days 8–14) — Creating the Action Kit: writing outreach scripts and messages, and documenting why Integrated Spaces beats competitors to help handle objections.",
    sourceFile: "Integrated Spaces Ltd Proposal.md"
  },
  {
    question: "What is the price for the Integrated Spaces proposal?",
    answer:
      "The service is priced at Rs 25,000 — a 50% discount from the standard rate of Rs 50,000. This discounted rate is offered specifically to initiate the relationship with Integrated Spaces Ltd.",
    sourceFile: "Integrated Spaces Ltd Proposal.md"
  },
  {
    question: "What does the Integrated Spaces project NOT include?",
    answer:
      "The project does not include execution. DeepThought (DT) will not provide sales staff, run advertisements, or make sales calls. This is a Strategy & Setup engagement — DT builds the blueprints and how-to guides, and Integrated Spaces (or their new hire) is responsible for running the process.",
    sourceFile: "Integrated Spaces Ltd Proposal.md"
  },
  {
    question: "What templates are delivered at the end of the Integrated Spaces project?",
    answer:
      "A Plug-and-Play folder is delivered at the end of Week 2, containing three execution path options: (1) Field Sales Path — Job Descriptions (JDs), interview questions, and daily report templates for an on-ground salesperson. (2) Telecalling Path — call scripts and lead-tracking sheets for a phone-based team. (3) Digital Agency Path — a vetting guide and performance scorecard to hire an external agency.",
    sourceFile: "Integrated Spaces Ltd Proposal.md"
  },
  {
    question: "Who is responsible for executing the Integrated Spaces project?",
    answer:
      "DeepThought (DT) is responsible for delivering all blueprints, scripts, templates, and the Sales Manual within 14 days. The execution of the sales process afterwards — making calls, hiring staff, running ads — is the responsibility of Integrated Spaces Ltd or their new hire.",
    sourceFile: "Integrated Spaces Ltd Proposal.md"
  },

  // ── Proposal _ Munchable.tv _ DT Intrapreneur Programme.md ────────────────

  {
    question: "What is the main deliverable for the Munchable.tv proposal?",
    answer:
      "The deliverable is a full-time DT Fellow (Business Analyst) deployed as a Full-Stack Operator. The Fellow integrates three operational layers into one role: Layer 3 (Strategy) — translating management's vision into actionable plans; Layer 2 (Management) — self-managing tasks, identifying bottlenecks, and course-correcting; Layer 1 (Execution) — hands-on operational work and project coordination.",
    sourceFile: "Proposal _ Munchable.tv _ DT Intrapreneur Programme.md"
  },
  {
    question: "What are the KPIs for the Munchable.tv engagement?",
    answer:
      "The core KPIs are: C-SAT (Customer Satisfaction), TAT (Turn Around Time), and Project Completion Rate. The DT Fellow is trained to review their own output against these KPIs, minimising the need for client-led supervision.",
    sourceFile: "Proposal _ Munchable.tv _ DT Intrapreneur Programme.md"
  },
  {
    question: "What is the pricing for the Munchable.tv proposal?",
    answer:
      "The retainer is ₹40,000 per candidate per month on a 12-month commitment. A non-refundable advance of ₹40,000 (one month's retainer) is required before the project starts; this advance is adjusted against the 12th month invoice. Invoices are raised at the beginning of each month and are payable within 7 days.",
    sourceFile: "Proposal _ Munchable.tv _ DT Intrapreneur Programme.md"
  },
  {
    question: "What is DeepThought's responsibility in the Munchable.tv engagement?",
    answer:
      "DeepThought is responsible for: (1) Continuous Learning & Development of the Fellow using a First Principles methodology. (2) Providing a replacement Fellow if Munchable.tv makes a formal request based on performance or cultural misfit. (3) Integrating timely feedback from the Client to calibrate the Fellow's strategic logic and operational output.",
    sourceFile: "Proposal _ Munchable.tv _ DT Intrapreneur Programme.md"
  },
  {
    question: "What is Munchable.tv's responsibility in the DT Fellowship engagement?",
    answer:
      "Munchable.tv is responsible for: (1) Strategic Access — providing context and goals for the Fellow to build Layer 3 plans. (2) Daily Supervision — the final sign-off that work produced aligns with company standards. (3) Tools & Access — providing access to required software, data, and internal communication channels.",
    sourceFile: "Proposal _ Munchable.tv _ DT Intrapreneur Programme.md"
  },
  {
    question: "What is the non-poaching clause for Munchable.tv?",
    answer:
      "Munchable.tv agrees not to solicit, hire, or engage the DT Fellow directly — as an employee or independent contractor — during the engagement and for 24 months following its termination. All systems and workflows built by the Fellow for Munchable.tv remain the exclusive intellectual property of Munchable.tv.",
    sourceFile: "Proposal _ Munchable.tv _ DT Intrapreneur Programme.md"
  },
  {
    question: "What is the Blueprint Service offered to Munchable.tv?",
    answer:
      "If Munchable.tv engages two DT Fellows, DeepThought provides a complimentary Blueprint Service valued at ₹50,000. The DT core team will conduct a Root Cause Analysis (RCA) and Current State Assessment (CSA) of Munchable's existing project workflows, then define a bespoke operating system before Fellows are deployed. This ensures new hires are onboarded into a structured environment with clear logic, significantly increasing Day-1 productivity.",
    sourceFile: "Proposal _ Munchable.tv _ DT Intrapreneur Programme.md"
  },

  // ── Unique International _ GTG Proposal.md ─────────────────────────────────

  {
    question: "What is the main deliverable for the Unique International proposal?",
    answer:
      "DeepThought will design a complete structured recruitment consulting package for Unique International's Technical Sales Executive hire. Deliverables include: Role Blueprint & KPI Mapping, Shortlisting Rubric, Role Assignment/Case Task, Structured Interview Framework, Candidate L&D Material (CNC basics, product profile, sales fundamentals, role clarity), and an Employer Branding Kit (founder introduction, company profile, role growth pathway, rewritten job description).",
    sourceFile: "Unique International _ GTG Proposal.md"
  },
  {
    question: "What are the pricing plans for the Unique International proposal?",
    answer:
      "Three plans are available: (1) Free Plan — ₹0, for a founder who wants process clarity only. (2) Fresher Plan — ₹50,000, payable as ₹25,000 upfront + ₹25,000 on the candidate joining, for hiring a 0–1 year experience candidate. (3) Experienced Plan — ₹1,00,000, payable as ₹50,000 upfront + ₹50,000 on joining, for hiring a CNC-experienced salesperson. The upfront fee covers fixed consulting work completed before hiring begins.",
    sourceFile: "Unique International _ GTG Proposal.md"
  },
  {
    question: "What is the timeline for the Unique International project?",
    answer:
      "The delivery timeline after approval is: Step 1 — a 45-minute requirement mapping call. Step 2 — the Role Blueprint delivered within 2 working days. Step 3 — the full selection system and L&D kit delivered within 5 working days from project approval.",
    sourceFile: "Unique International _ GTG Proposal.md"
  },
  {
    question: "Who is responsible for the Unique International project?",
    answer:
      "DeepThought (DT) is responsible for designing the selection process, creating candidate learning materials, and building employer branding assets. DT is a consulting firm — it does not source candidates, charge per CV, or promise a specific number of candidates. Unique International is responsible for conducting the actual interviews and making the final hiring decision.",
    sourceFile: "Unique International _ GTG Proposal.md"
  },
  {
    question: "What is the KPI or hiring goal for Unique International?",
    answer:
      "The goal is to hire a Technical Sales Executive with CNC/machining knowledge (or fast learning ability), an ownership mindset, and the confidence to represent Unique International as the company's first non-founder hire. A key risk to mitigate: previous unstructured hiring attempts have failed, and a wrong hire costs approximately ₹2 lakhs over 4 months.",
    sourceFile: "Unique International _ GTG Proposal.md"
  },
  {
    question: "What does DeepThought NOT do for Unique International?",
    answer:
      "DeepThought does not: (1) Act as a recruitment agency. (2) Charge per CV submitted. (3) Promise or guarantee a specific number of candidates. DT's role is designing the hiring system — the selection process, learning materials, and employer branding — that gives Unique International the best chance of finding the right candidate independently.",
    sourceFile: "Unique International _ GTG Proposal.md"
  }
];

// Shared vocabulary for agent dossiers. Kept in one place so the API can
// reject values the UI would never offer.

/** Clearance ladder: what an agent is allowed to do. */
export const CLEARANCE_LEVELS = [
  { level: 0, label: 'Guest / External' },
  { level: 1, label: 'Employee / User' },
  { level: 2, label: 'Power User' },
  { level: 3, label: 'Supervisor / Team Lead' },
  { level: 4, label: 'Department Manager' },
  { level: 5, label: 'Department Administrator' },
  { level: 6, label: 'System Administrator' },
  { level: 7, label: 'Security Administrator' },
  { level: 8, label: 'Super Administrator' },
] as const;

/** Data sensitivity ladder: what an agent is allowed to see. */
export const DATA_TYPE_LEVELS = [
  { level: 1, label: 'Public' },
  { level: 2, label: 'Internal' },
  { level: 3, label: 'Confidential' },
  { level: 4, label: 'Restricted' },
  { level: 5, label: 'Highly Restricted' },
  { level: 6, label: 'Executive Only' },
  { level: 7, label: 'Board Only' },
  { level: 8, label: 'Corporate Secret' },
  { level: 9, label: 'Strategic Secret' },
  { level: 10, label: 'Black Access' },
  { level: 11, label: 'Cosmic Access (Ultra Classified)' },
  { level: 12, label: 'Omega Access' },
  { level: 13, label: 'Genesis Access' },
  { level: 14, label: 'Palantir Access (Root Clearance)' },
] as const;

/**
 * Roles, grouped for the UI and alphabetised within each group. A flat A-Z
 * list of this many entries is unusable in a dropdown; the groups become
 * <optgroup> labels.
 */
export const ROLE_GROUPS: { group: string; roles: string[] }[] = [
  {
    group: 'Business & Operations',
    roles: [
      'Accountant',
      'AP Clerk',
      'AR Clerk',
      'Auditor',
      'Buyer',
      'Compliance Officer',
      'CRM Manager',
      'Customer Support Agent',
      'Employee',
      'Executive',
      'HR Manager',
      'HR Specialist',
      'Inventory Clerk',
      'Marketing Specialist',
      'Payroll Specialist',
      'Production Planner',
      'Purchasing Agent',
      'Recruiter',
      'Sales Manager',
      'Sales Representative',
      'Warehouse Manager',
    ],
  },
  {
    group: 'Software — Frontend',
    roles: [
      'Angular Developer',
      'Flutter Developer',
      'Frontend Developer',
      'Frontend Engineer',
      'Mobile Developer (Android)',
      'Mobile Developer (iOS)',
      'React Developer',
      'React Native Developer',
      'UI Engineer',
      'Vue.js Developer',
      'Web Developer',
    ],
  },
  {
    group: 'Software — Backend',
    roles: [
      'API Developer',
      'Backend Developer',
      'Backend Engineer',
      'Distributed Systems Engineer',
      'Integration Engineer',
      'Middleware Engineer',
      'Platform Engineer',
      'Systems Engineer',
    ],
  },
  {
    group: 'Software — Full Stack & Desktop',
    roles: [
      'Desktop Application Developer',
      'Full Stack Developer',
      'Full Stack Engineer',
      'macOS Developer',
      'Windows Developer',
    ],
  },
  {
    group: 'Embedded & Robotics',
    roles: [
      'Embedded Software Engineer',
      'Firmware Engineer',
      'IoT Engineer',
      'Robotics Software Engineer',
    ],
  },
  {
    group: 'Artificial Intelligence',
    roles: [
      'AI Engineer',
      'AI Infrastructure Engineer',
      'AI Platform Engineer',
      'AI Research Scientist',
      'AI Safety Engineer',
      'Computer Vision Engineer',
      'Deep Learning Engineer',
      'Generative AI Engineer',
      'LLM Engineer',
      'Machine Learning Engineer',
      'MLOps Engineer',
      'NLP Engineer',
      'Prompt Engineer',
      'Reinforcement Learning Engineer',
      'Speech Recognition Engineer',
    ],
  },
  {
    group: 'Data & Analytics',
    roles: [
      'Analytics Engineer',
      'BI Developer',
      'Big Data Engineer',
      'Business Intelligence (BI) Analyst',
      'Data Analyst',
      'Data Architect',
      'Data Engineer',
      'Data Governance Analyst',
      'Data Quality Engineer',
      'Data Scientist',
      'ETL Developer',
      'Reporting Analyst',
    ],
  },
  {
    group: 'Database',
    roles: [
      'Data Warehouse Engineer',
      'Database Administrator (DBA)',
      'Database Developer',
      'Database Engineer',
      'NoSQL Engineer',
      'SQL Developer',
    ],
  },
  {
    group: 'DevOps & Cloud',
    roles: [
      'Automation Engineer',
      'Build Engineer',
      'CI/CD Engineer',
      'Cloud Architect',
      'Cloud Engineer',
      'Infrastructure Engineer',
      'Kubernetes Engineer',
      'Linux Systems Engineer',
      'Network Cloud Engineer',
      'Release Engineer',
      'Site Reliability Engineer (SRE)',
      'Windows Systems Engineer',
    ],
  },
  {
    group: 'Cybersecurity',
    roles: [
      'Application Security Engineer',
      'Blue Team Analyst',
      'Cloud Security Engineer',
      'Compliance Analyst',
      'Cybersecurity Analyst',
      'Digital Forensics Analyst',
      'Ethical Hacker',
      'GRC Analyst',
      'IAM Engineer',
      'Identity Engineer',
      'Incident Response Analyst',
      'Malware Analyst',
      'Penetration Tester',
      'Purple Team Engineer',
      'Red Team Operator',
      'Security Architect',
      'Security Engineer',
      'Security Operations Engineer',
      'SOC Analyst',
      'Threat Intelligence Analyst',
      'Vulnerability Analyst',
    ],
  },
  {
    group: 'Networking',
    roles: [
      'Network Administrator',
      'Network Architect',
      'Network Engineer',
      'Network Security Engineer',
      'Telecom Engineer',
      'VoIP Engineer',
      'Wireless Engineer',
    ],
  },
  {
    group: 'Systems & IT',
    roles: [
      'Backup Administrator',
      'Desktop Support Technician',
      'Field Support Engineer',
      'Help Desk Technician',
      'Infrastructure Administrator',
      'IT Administrator',
      'IT Support Specialist',
      'Storage Engineer',
      'Systems Administrator',
      'Technical Support Engineer',
    ],
  },
  {
    group: 'Quality Assurance',
    roles: [
      'Load Testing Engineer',
      'Manual QA Tester',
      'Performance Test Engineer',
      'QA Automation Engineer',
      'QA Engineer',
      'Software Test Engineer',
      'Test Automation Architect',
      'Validation Engineer',
    ],
  },
  {
    group: 'Product & Design',
    roles: [
      'Information Architect',
      'Interaction Designer',
      'Product Designer',
      'Product Manager',
      'Product Owner',
      'Program Manager',
      'Project Manager',
      'Technical Product Manager',
      'Technical Program Manager (TPM)',
      'UI Designer',
      'UX Designer',
      'UX Researcher',
      'Visual Designer',
    ],
  },
  {
    group: 'Enterprise Applications',
    roles: [
      'CRM Administrator',
      'CRM Developer',
      'ERP Administrator',
      'ERP Consultant',
      'ERP Developer',
      'Microsoft Dynamics Consultant',
      'Oracle ERP Consultant',
      'Salesforce Administrator',
      'Salesforce Architect',
      'Salesforce Developer',
      'SAP ABAP Developer',
      'SAP Basis Administrator',
      'SAP Consultant',
      'SAP Developer',
      'SAP Functional Consultant',
    ],
  },
  {
    group: 'Game Development',
    roles: [
      'AI Gameplay Programmer',
      'Game Designer',
      'Game Engine Programmer',
      'Game Producer',
      'Gameplay Programmer',
      'Graphics Programmer',
      'Level Designer',
      'Multiplayer Engineer',
      'Physics Programmer',
      'Technical Artist',
    ],
  },
  {
    group: 'Blockchain & Web3',
    roles: [
      'Blockchain Engineer',
      'Cryptography Engineer',
      'Smart Contract Developer',
      'Solidity Developer',
      'Web3 Engineer',
    ],
  },
  {
    group: 'Research',
    roles: [
      'Algorithm Engineer',
      'Applied Scientist',
      'Computational Scientist',
      'Research Engineer',
      'Research Scientist',
    ],
  },
  {
    group: 'Technical Documentation',
    roles: ['Documentation Engineer', 'Knowledge Engineer', 'Technical Writer'],
  },
  {
    group: 'Individual Contributor Track',
    roles: [
      'Distinguished Engineer',
      'Intern',
      'Junior Engineer',
      'Principal Engineer',
      'Senior Software Engineer',
      'Software Engineer I',
      'Software Engineer II',
      'Staff Engineer',
      'Technical Fellow',
    ],
  },
  {
    group: 'Leadership',
    roles: [
      'Chief AI Officer (CAIO)',
      'Chief Architect',
      'Chief Data Officer (CDO)',
      'Chief Information Officer (CIO)',
      'Chief Information Security Officer (CISO)',
      'Chief Technology Officer (CTO)',
      'Development Lead',
      'Director of Engineering',
      'Engineering Manager',
      'Enterprise Architect',
      'Senior Director',
      'Senior Engineering Manager',
      'Software Development Manager',
      'Solutions Architect',
      'Team Lead',
      'Technical Lead',
      'Vice President of Engineering',
    ],
  },
];

/** Flat set of every valid role, for validation. */
export const ROLES: string[] = ROLE_GROUPS.flatMap((g) => g.roles);
const ROLE_SET = new Set(ROLES);

export const DEFAULT_ROLE = 'Employee';
export const DEFAULT_CLEARANCE = 1;
export const DEFAULT_DATA_TYPE = 2;
export const DEFAULT_TENURE = 'New hire';

/**
 * @deprecated Do NOT use this to validate a role. ROLE_GROUPS is a SEED, not the
 * source of truth: roles live in the `Role` table, and the Roles tab can add,
 * rename and delete them. This returned false for every role created in the app
 * and for the mythic roles the shipped cast wears, which rejected dossier saves
 * with `role "Archmage" is not a known role`.
 *
 * Use `roleExists()` from moduleservices/roleService instead. Kept only because
 * ROLE_SET still serves the seed and the type guard has no other callers.
 */
export const isRole = (value: unknown): value is string =>
  typeof value === 'string' && ROLE_SET.has(value);

export const isClearance = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  CLEARANCE_LEVELS.some((c) => c.level === value);

export const isDataType = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  DATA_TYPE_LEVELS.some((d) => d.level === value);

export const clearanceLabel = (level: number): string =>
  CLEARANCE_LEVELS.find((c) => c.level === level)?.label ?? 'Unknown';

export const dataTypeLabel = (level: number): string =>
  DATA_TYPE_LEVELS.find((d) => d.level === level)?.label ?? 'Unknown';

# Backend Database Schema - Custom Business Entities

**Last Updated:** April 6, 2026  
**Current Schema Version:** 4.7.0  
**Database Backends:** MongoDB (primary), PostgreSQL (legacy support)  

---

## Overview

The backend manages **two core business systems**:

1. **Organizational Structure** - Organizations, Departments, Roles, Memberships
2. **HVT System** (High Value Thinking) - Innovation tracking: Modules, Problems, Ideas, Experiments, Results, Learnings, Escalations

**Note:** NodeBB is used for API/forum features only. The schema documented here focuses exclusively on custom business entities.

---

## Table of Contents

1. [Organizational Entities](#organizational-entities)
2. [HVT System Entities](#hvt-system-entities)
3. [Entity Relationships](#entity-relationships)
4. [Key Patterns & Naming](#key-patterns--naming)
5. [Database Collections](#database-collections)
6. [Operational Patterns](#operational-patterns)

---

## Organizational Entities

### 1. Organization (organization:{orgId})

**Purpose:** Top-level company/enterprise entity

**Fields:**
| Field | Type | Example | Required |
|-------|------|---------|----------|
| orgId | String | "123" | ✓ |
| name | String | "Acme Corp" | ✓ |
| sector | String | "Technology" | ✓ |
| website | String | "https://acme.com" | ✗ |
| about | String | "Company description" | ✗ |
| employeeRange | String | "1000-5000" | ✗ |
| emails | String[] | ["contact@acme.com"] | ✗ |
| phoneNumbers | String[] | ["+1-555-0123"] | ✗ |
| locations | String[] | ["San Francisco, CA"] | ✗ |
| socialLinks | Object | {linkedin: "url", twitter: "url"} | ✗ |
| leaders | String[] | ["uid1", "uid2"] | ✗ |
| images | Object | {logo: "url", banner: "url"} | ✗ |
| state | String | "active" | ✓ |
| timestamp | Number | 1704067200000 | ✓ |
| lastmodified | Number | 1704067200000 | ✓ |
| lastmodifiedBy | String | "uid99" | ✓ |

**Key Indices:**
```
organizations:sorted                  // Sorted set: orgId → timestamp
organizations:active                  // Set: Active organization IDs
organizations:sector:{sector}         // Set: Organization IDs by sector
organization:{orgId}:members:active   // Set: Member UIDs in organization
organization:{orgId}:members:sorted   // Sorted set: uid → join timestamp
organization:{orgId}:managers         // Set: Manager UIDs
organization:{orgId}:leaders          // Set: Leader UIDs
organization:{orgId}:departments      // Set: Department IDs
organization:{orgId}:departments:sorted    // Sorted set: deptId → timestamp
organization:{orgId}:roles            // Set: Role IDs
organization:{orgId}:roles:sorted     // Sorted set: roleId → timestamp
```

---

### 2. Department (department:{deptId})

**Purpose:** Organizational subdivision (supports hierarchy)

**Fields:**
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| deptId | String | "456" | Unique dept ID |
| organizationId | String | "123" | Parent org (required) |
| parentDepartmentId | String/null | "400" | For hierarchical structure |
| name | String | "Engineering" | ✓ Required |
| description | String | "Software engineering team" | Optional |
| level | Number | 0 | Hierarchy depth |
| state | String | "active" | active\|deleted |
| timestamp | Number | 1704067200000 | Creation time |
| lastmodified | Number | 1704067200000 | Last update |
| lastmodifiedBy | String | "uid99" | Who modified |

**Key Indices:**
```
department:{deptId}:members:active    // Set: Member UIDs
department:{deptId}:members:sorted    // Sorted set: uid → timestamp
department:{deptId}:managers          // Set: Manager UIDs
department:{deptId}:roles             // Set: Role IDs in dept
department:{deptId}:children          // Set: Child department IDs
```

---

### 3. Role (role:{roleId})

**Purpose:** Job title/position within organization or department

**Fields:**
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| roleId | String | "789" | Unique role ID |
| organizationId | String | "123" | Parent org (required) |
| departmentId | String/null | "456" | Optional dept scope |
| name | String | "Senior Engineer" | ✓ Required |
| description | String | "Senior engineering role" | Optional |
| scope | String | "organization" | organization\|department |
| state | String | "active" | active\|deleted |
| timestamp | Number | 1704067200000 | Creation time |
| lastmodified | Number | 1704067200000 | Last update |
| lastmodifiedBy | String | "uid99" | Who modified |

**Key Indices:**
```
organization:{orgId}:roles:sorted     // Sorted set: roleId → timestamp
organization:{orgId}:roles            // Set: Role IDs in org
department:{deptId}:roles             // Set: Role IDs in dept (if scoped)
```

---

### 4. Membership (membership:{membershipId})

**Purpose:** Links users to organizations/departments/roles

**Fields:**
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| membershipId | String | "111" | Unique membership ID |
| uid | String | "user1" | User ID (required) |
| organizationId | String | "123" | Organization (required) |
| departmentId | String/null | "456" | Optional department |
| type | String | "member" | member\|manager\|leader |
| roleId | String/null | "789" | Optional role assignment |
| status | String | "active" | active\|removed |
| joinedAt | Number | 1704067200000 | Join timestamp |
| removedAt | Number/null | null | Removal timestamp |
| timestamp | Number | 1704067200000 | Creation time |
| lastmodified | Number | 1704067200000 | Last update |

**Key Indices:**
```
uid:{uid}:memberships:active          // Set: Active membership IDs
uid:{uid}:organizations               // Set: Organizations user belongs to
organization:{orgId}:members:active   // Set: Active member UIDs
organization:{orgId}:members:sorted   // Sorted set: uid → joinTimestamp
organization:{orgId}:managers         // Set: Manager UIDs
organization:{orgId}:leaders          // Set: Leader UIDs
department:{deptId}:members:active    // Set: Members in dept
department:{deptId}:members:sorted    // Sorted set: uid → timestamp
department:{deptId}:managers          // Set: Manager UIDs in dept
```

**Status Values:** `active` | `removed`

**Membership Types:**
- `member` - Regular member
- `manager` - Department/team manager
- `leader` - Organization leader

---

## HVT System Entities

**Overview:** High Value Thinking system for tracking innovation from problem identification through experiments and learning.

**Flow:** Module → Problem → Idea → Experiment → Result/Learning

### 5. HVT Module (hvt:module:{moduleId})

**Purpose:** Topic/domain for innovation tracking within organization

**Default Modules:**
1. Sales (🎯) - Customer acquisition
2. Marketing (📢) - Campaign and brand initiatives
3. Product (🎨) - Feature and UX experiments
4. Engineering (⚙️) - Technical debt and architecture
5. Operations (📊) - Process efficiency
6. Finance (💰) - Pricing and cost optimization
7. Customer Success (💬) - Retention and satisfaction
8. HR (👥) - Culture and talent development

**Fields:**
| Field | Type | Example |
|-------|------|---------|
| id | String | "1" |
| orgId | String | "123" |
| name | String | "Engineering" |
| description | String | "Technical experiments" |
| color | String | "#3B82F6" |
| createdAt | ISO String | "2026-01-15T10:30:00Z" |
| updatedAt | ISO String | "2026-01-15T10:30:00Z" |

**Key Indices:**
```
hvt:modules:org:{orgId}:sorted        // Sorted set: moduleId → timestamp
hvt:modules:sorted                    // All modules globally
```

---

### 6. HVT Problem (hvt:problem:{problemId})

**Purpose:** Challenge/issue to be solved within a module

**Status Flow:** `identified` → `under_analysis` → `ideation` → `closed`

**Fields:**
| Field | Type | Example |
|-------|------|---------|
| id | String | "1" |
| orgId | String | "123" |
| moduleId | String | "1" |
| title | String | "User onboarding takes too long" |
| description | String | "Users spend 15min on setup" |
| impact | String | "High" |
| status | String | "under_analysis" |
| createdBy | String | "uid1" |
| createdAt | ISO String | "2026-01-15T10:30:00Z" |
| updatedAt | ISO String | "2026-01-15T10:30:00Z" |

**Key Indices:**
```
hvt:problems:org:{orgId}:sorted       // Sorted set: problemId → timestamp
hvt:problems:module:{moduleId}        // Set: Problem IDs in module
```

---

### 7. HVT Idea (hvt:idea:{ideaId})

**Purpose:** Proposed solution to a problem

**Status Flow:** `draft` → `submitted` → `approved`/`rejected` → `in_progress`

**Fields:**
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| id | String | "1" | Unique idea ID |
| orgId | String | "123" | Organization |
| problemId | String | "1" | Parent problem |
| title | String | "Add guided tour wizard" | ✓ Required |
| description | String | "Interactive onboarding flow" | Optional |
| status | String | "draft" | draft\|submitted\|approved\|rejected\|in_progress |
| createdBy | String | "uid1" | Creator |
| createdAt | ISO String | "2026-01-15T10:30:00Z" | |
| updatedAt | ISO String | "2026-01-15T10:30:00Z" | |
| ice | Object | {impact: 10, confidence: 8, ease: 7} | ICE scoring |

**Key Indices:**
```
hvt:ideas:org:{orgId}:sorted          // Sorted set: ideaId → timestamp
hvt:ideas:problem:{problemId}         // Set: Ideas for problem
```

---

### 8. HVT Experiment (hvt:experiment:{experimentId})

**Purpose:** Structured test of an idea

**Status Flow (State Machine):**
```
seeded → probing → active → blocked → logging → ready_for_hash → completed
         ├→ halted
         └→ any other state
```

**Fields:**
| Field | Type | Example | Notes |
|-------|------|---------|-------|
| id | String | "1" | Unique experiment ID |
| orgId | String | "123" | Organization |
| ideaId | String | "1" | Parent idea |
| title | String | "Test guided tour impact" | ✓ Required |
| description | String | "A/B test wizard vs. traditional" | |
| status | String | "active" | See state machine |
| hypothesis | String | "Will reduce setup time by 30%" | |
| successCriteria | String | "Avg time < 5 minutes" | |
| duration | Number | 14 | Days |
| startDate | ISO String | "2026-01-15T10:30:00Z" | |
| endDate | ISO String | "2026-01-29T10:30:00Z" | |
| createdBy | String | "uid1" | |
| createdAt | ISO String | "2026-01-15T10:30:00Z" | |
| updatedAt | ISO String | "2026-01-15T10:30:00Z" | |

**Key Indices:**
```
hvt:experiments:org:{orgId}:sorted       // Sorted set: experimentId → timestamp
hvt:experiments:status:{status}          // Set: Experiments by status
hvt:experiments:idea:{ideaId}            // Set: Experiments for idea
```

---

### 9. HVT Result (hvt:result:{resultId})

**Purpose:** Measured outcome from experiment

**Fields:**
| Field | Type | Example |
|-------|------|---------|
| id | String | "1" |
| experimentId | String | "1" |
| metric | String | "avg_setup_time_seconds" |
| value | Number | 280 |
| timestamp | ISO String | "2026-01-20T10:30:00Z" |
| notes | String | "Measured from analytics" |

**Key Indices:**
```
hvt:results:experiment:{experimentId}  // Set: Results for experiment
```

---

### 10. HVT Learning (hvt:learning:{learningId})

**Purpose:** Knowledge/insight captured from experiments

**Fields:**
| Field | Type | Example |
|-------|------|---------|
| id | String | "1" |
| orgId | String | "123" |
| experimentId | String | "1" |
| title | String | "Visual guides work better than text" |
| insight | String | "Users respond 40% faster with guides" |
| applicability | String | "High" |
| archived | Boolean | false |
| createdAt | ISO String | "2026-01-15T10:30:00Z" |
| updatedAt | ISO String | "2026-01-15T10:30:00Z" |

**Key Indices:**
```
hvt:learnings:org:{orgId}:sorted      // Sorted set: learningId → timestamp
hvt:learnings:experiment:{experimentId}  // Set: Learnings from experiment
```

---

### 11. HVT Escalation (hvt:escalation:{escalationId})

**Purpose:** Blockers/issues that need resolution during experiment

**Status Flow:** `open` → `in_progress` → `resolved`

**Fields:**
| Field | Type | Example |
|-------|------|---------|
| id | String | "1" |
| experimentId | String | "1" |
| title | String | "Budget approval needed" |
| description | String | "PR spend for advertising" |
| severity | String | "High" |
| status | String | "open" |
| createdAt | ISO String | "2026-01-15T10:30:00Z" |

**Key Indices:**
```
hvt:escalations:experiment:{experimentId}  // Escalations for experiment
```

---

### 12. HVT Ticket (hvt:ticket:{ticketId})

**Purpose:** External issue/ticket reference for implementation tasks

**Fields:**
| Field | Type | Example |
|-------|------|---------|
| id | String | "1" |
| experimentId | String | "1" |
| externalId | String | "JIRA-123" |
| source | String | "jira" |
| title | String | "Implement wizard UI" |
| url | String | "https://jira.company.com/..." |

---

### 13. HVT Update (hvt:update:{updateId})

**Purpose:** Progress notes on experiment

**Fields:**
| Field | Type | Example |
|-------|------|---------|
| id | String | "1" |
| experimentId | String | "1" |
| note | String | "Reached 50% of target users" |
| timestamp | ISO String | "2026-01-20T10:30:00Z" |
| createdBy | String | "uid1" |

---

### 14. HVT User Role (hvt:role:{orgId}:{uid})

**Purpose:** HVT-specific permissions per user within organization

**Fields:**
| Field | Type | Example |
|-------|------|---------|
| uid | String | "uid1" |
| orgId | String | "123" |
| role | String | "contributor" |
| permittedModules | String[] | ["1", "2", "3"] |

**Possible Roles:**
- `contributor` - Can create/edit experiments
- `reviewer` - Can approve ideas, review results
- `admin` - Full HVT administration

---

## Entity Relationships

### Organizational Hierarchy

```
Organization
├── Departments (hierarchical tree)
│   ├── Subdepartments (if parentDepartmentId set)
│   ├── Members (via Membership: department ↔ user)
│   ├── Managers (subset of members with type=manager)
│   └── Roles (department-scoped positions)
├── Roles (organization-level positions)
├── Members (via Membership: organization ↔ user)
├── Managers (subset with type=manager)
└── Leaders (subset with type=leader)
```

### HVT Workflow

```
Module
└── Problem (per module)
    └── Ideas (multiple per problem)
        └── Experiment (per idea)
            ├── Results (measurements)
            ├── Learnings (captured insights)
            ├── Escalations (blockers)
            ├── Tickets (implementation tasks)
            └── Updates (progress notes)
```

### User ↔ Organization Connection

```
User (uid)
└── Membership (connect point)
    ├── orgId → Organization
    ├── departmentId → Department (optional)
    ├── roleId → Role (optional)
    └── type → member|manager|leader
```

---

## Database Collections

### MongoDB Collections

**Two collections store all custom entities:**

#### 1. `organizations` Collection
Stores: Organizations, Departments, Roles, Memberships

```javascript
// Organizations
db.organizations.find({ _key: "organization:123" })

// Departments
db.organizations.find({ _key: "department:456" })

// Roles
db.organizations.find({ _key: "role:789" })

// Memberships
db.organizations.find({ _key: "membership:111" })
```

#### 2. `hvt` Collection
Stores: Modules, Problems, Ideas, Experiments, Results, Learnings, Escalations, Tickets, Updates

```javascript
// Modules
db.hvt.find({ _key: "hvt:module:1" })

// Problems
db.hvt.find({ _key: "hvt:problem:1" })

// Ideas
db.hvt.find({ _key: "hvt:idea:1" })

// Experiments
db.hvt.find({ _key: "hvt:experiment:1" })

// Learnings
db.hvt.find({ _key: "hvt:learning:1" })
```

---

## Key Naming Patterns

### Pattern Convention

```
{entity_type}:{id}                           // Entity hash/document
{entity_type}:{id}:{property}                // Property of entity
{collection}:{sorted|active}                 // Index sets
{parent_type}:{id}:{child_type}:{qualifier}  // Relationships
```

### Global Counters

```
global:nextOrgId                // Next organization ID
global:nextDeptId               // Next department ID
global:nextRoleId               // Next role ID
global:nextMembershipId         // Next membership ID
global:nextHVTModuleId          // Next HVT module ID
global:nextHVTProblemId         // Next HVT problem ID
global:nextHVTIdeaId            // Next HVT idea ID
global:nextHVTExperimentId      // Next HVT experiment ID
```

---

## Operational Patterns

### Pagination

**Sorted Sets for Pagination:**
```javascript
// Get page 2 (20 items per page)
const start = (2 - 1) * 20;  // 20
const stop = start + 20 - 1;  // 39

db.getSortedSetRevRange('organizations:sorted', start, stop)
```

### Multi-tenancy (Organization Scoping)

**All queries include organization context:**
```javascript
// Only gets problems in this organization
db.getHVTProblemsByOrg(orgId, startIdx, stopIdx)

// Only gets members in this organization
db.getOrganizationMembers(orgId)

// Only gets modules for this organization
db.getHVTModulesByOrg(orgId)
```

### Membership Status Management

**Active vs. Removed:**
```javascript
// Get active members only
db.getSetMembers('organization:123:members:active')

// Remove membership
db.removeMembership(membershipId)  // Sets status to 'removed'
                                    // Removes from all :active indices
```

### State Machines

**Experiment Status Transitions:**
```
seeded ──→ probing
           ├─→ active ──→ blocked
           │             ├──→ logging ──→ ready_for_hash ──→ completed
           │
           └─→ halted (from any state)
```

**Validation enforced by application logic** - no status can skip states

### Soft Deletes

**All entities support soft delete:**
```javascript
// Instead of removing, set state field
organization.state = 'deleted'        // state: active|deleted
department.state = 'deleted'
role.state = 'deleted'
```

---

## Global Configuration

**System-wide settings stored as:**
```
global                             // Hash: system configuration
global:organizations:maxPerPage    // String: pagination limit
```

---

## Query Examples

### Get Organization with All Related Data

```javascript
// 1. Get organization base data
org = db.getOrganization(orgId)

// 2. Get all departments
deptIds = db.getSetMembers(`organization:${orgId}:departments`)
departments = db.getDepartments(deptIds)

// 3. Get all active members
memberIds = db.getSetMembers(`organization:${orgId}:members:active`)

// 4. Get all roles
roleIds = db.getSetMembers(`organization:${orgId}:roles`)
roles = db.getRoles(roleIds)
```

### Get User's Organizational Memberships

```javascript
// 1. Get user's membership IDs
membershipIds = db.getSetMembers(`uid:${uid}:memberships:active`)

// 2. Get membership details
memberships = db.getMemberships(membershipIds)

// 3. For each membership, get organization/dept/role
for (const membership of memberships) {
  org = db.getOrganization(membership.organizationId)
  dept = membership.departmentId ? db.getDepartment(membership.departmentId) : null
  role = membership.roleId ? db.getRole(membership.roleId) : null
}
```

### List HVT Experiments for Organization

```javascript
// Get active experiments (all statuses)
experimentIds = db.getSortedSetRevRange(
  `hvt:experiments:org:${orgId}:sorted`,
  0,
  19  // First 20
)

experiments = db.getHVTExperiments(experimentIds)

// Filter by status
activeExperiments = experiments.filter(e => e.status === 'active')
completedExperiments = experiments.filter(e => e.status === 'completed')
```

### Get Problem with All Ideas and Experiments

```javascript
// 1. Get problem
problem = db.getHVTProblem(problemId)

// 2. Get all ideas for problem
ideaIds = db.getSetMembers(`hvt:ideas:problem:${problemId}`)
ideas = db.getHVTIdeas(ideaIds)

// 3. For each idea, get experiments
for (const idea of ideas) {
  experimentIds = db.getSetMembers(`hvt:experiments:idea:${idea.id}`)
  idea.experiments = db.getHVTExperiments(experimentIds)
}
```

---

## API Response Structure

### Organization Response

```json
{
  "orgId": "123",
  "name": "Acme Corp",
  "sector": "Technology",
  "website": "https://acme.com",
  "about": "Company description",
  "employeeRange": "1000-5000",
  "emails": ["contact@acme.com"],
  "phoneNumbers": ["+1-555-0123"],
  "locations": ["San Francisco, CA"],
  "socialLinks": {
    "linkedin": "url",
    "twitter": "url"
  },
  "leaders": ["uid1", "uid2"],
  "images": {
    "logo": "url",
    "banner": "url"
  },
  "state": "active",
  "timestamp": 1704067200000,
  "lastmodified": 1704067200000,
  "lastmodifiedBy": "uid99"
}
```

### HVT Experiment Response

```json
{
  "id": "1",
  "orgId": "123",
  "ideaId": "1",
  "title": "Test guided tour impact",
  "description": "A/B test wizard vs traditional",
  "status": "active",
  "hypothesis": "Will reduce setup time by 30%",
  "successCriteria": "Avg time < 5 minutes",
  "duration": 14,
  "startDate": "2026-01-15T10:30:00Z",
  "endDate": "2026-01-29T10:30:00Z",
  "createdBy": "uid1",
  "createdAt": "2026-01-15T10:30:00Z",
  "updatedAt": "2026-01-15T10:30:00Z"
}
```

---

## Notes

- **No Auth/User Data**: User authentication and profiles are handled by NodeBB integration layer. This schema covers only business entities.
- **Timestamps**: Always stored as Unix timestamps (milliseconds) or ISO strings depending on entity
- **Soft Deletes**: Deleted entities retain data but have `state: 'deleted'` flag
- **Organization Scoping**: All HVT and organizational data is organization-scoped for multi-tenancy
- **Auto-incrementing IDs**: Uses global counters (`global:nextXxxId`), not UUIDs
- **Indexing**: Sorted sets enable efficient pagination by timestamp
- **State Machines**: Experiment status transitions are enforced by application logic

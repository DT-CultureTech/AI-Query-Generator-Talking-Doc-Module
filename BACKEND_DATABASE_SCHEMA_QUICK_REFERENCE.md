# Backend Database Schema - Quick Reference

**Updated:** April 6, 2026  
**Version:** 4.7.0

---

## What's Stored (13 Custom Entities)

| Entity | Storage | Key Pattern | Purpose |
|--------|---------|-------------|---------|
| **Organization** | MongoDB | `organization:{id}` | Company/enterprise |
| **Department** | MongoDB | `department:{id}` | Org subdivisions |
| **Role** | MongoDB | `role:{id}` | Job titles/positions |
| **Membership** | MongoDB | `membership:{id}` | User→Org bridge |
| **HVT Module** | MongoDB | `hvt:module:{id}` | Innovation topics |
| **HVT Problem** | MongoDB | `hvt:problem:{id}` | Issues to solve |
| **HVT Idea** | MongoDB | `hvt:idea:{id}` | Proposed solutions |
| **HVT Experiment** | MongoDB | `hvt:experiment:{id}` | Structured tests |
| **HVT Result** | MongoDB | `hvt:result:{id}` | Measured outcomes |
| **HVT Learning** | MongoDB | `hvt:learning:{id}` | Captured insights |
| **HVT Escalation** | MongoDB | `hvt:escalation:{id}` | Blockers/issues |
| **HVT Ticket** | MongoDB | `hvt:ticket:{id}` | Implementation tasks |
| **HVT Update** | MongoDB | `hvt:update:{id}` | Progress notes |

---

## Key Indices (Cheat Sheet)
### Organization Indices
```
organizations:sorted                     // All orgs by timestamp
organizations:active                     // Active org IDs
organizations:sector:{sector}            // Orgs by sector

organization:{id}:members:active         // Member IDs
organization:{id}:members:sorted         // Members by join date
organization:{id}:managers               // Manager UIDs
organization:{id}:leaders                // Leader UIDs
organization:{id}:departments            // Department IDs
organization:{id}:departments:sorted     // Depts by timestamp
organization:{id}:roles                  // Role IDs
organization:{id}:roles:sorted           // Roles by timestamp
```

### Department Indices
```
department:{id}:members:active           // Member IDs
department:{id}:members:sorted           // Members by timestamp
department:{id}:managers                 // Manager UIDs
department:{id}:roles                    // Role IDs
department:{id}:children                 // Child departments
```

### HVT Indices
```
hvt:modules:org:{orgId}:sorted           // Modules per org
hvt:problems:org:{orgId}:sorted          // Problems per org
hvt:problems:module:{id}                 // Problems by module
hvt:ideas:org:{orgId}:sorted             // Ideas per org
hvt:ideas:problem:{id}                   // Ideas by problem
hvt:experiments:org:{orgId}:sorted       // Experiments per org
hvt:experiments:status:{status}          // Experiments by status
hvt:experiments:idea:{id}                // Experiments by idea
hvt:learnings:org:{orgId}:sorted         // Learnings per org
hvt:learnings:experiment:{id}            // Learnings per experiment
hvt:results:experiment:{id}              // Results per experiment
hvt:escalations:experiment:{id}          // Escalations per experiment
```

### User Indices
```
uid:{uid}:memberships:active             // User's active memberships
uid:{uid}:organizations                  // User's organizations
```

---

## Entity Fields (Minimal Summary)

Organization | `orgId` | `name` | `sector` | `website` | `about` | `employeeRange` | `emails` | `phoneNumbers`
Department | `deptId` | `organizationId` | `parentDepartmentId` | `name` | `level` | `state`
Role | `roleId` | `organizationId` | `departmentId` | `name` | `scope` | `state`
Membership | `membershipId` | `uid` | `organizationId` | `departmentId` | `type` | `roleId` | `status`
HVT Module | `id` | `orgId` | `name` | `description` | `color`
HVT Problem | `id` | `orgId` | `moduleId` | `title` | `impact` | `status`
HVT Idea | `id` | `orgId` | `problemId` | `title` | `status` | `ice` (score)
HVT Experiment | `id` | `orgId` | `ideaId` | `title` | `status` | `hypothesis` | `duration`
HVT Learning | `id` | `orgId` | `experimentId` | `title` | `insight` | `applicability`

---

## Status & State Values

**Membership**
- `status`: `active` | `removed`
- `type`: `member` | `manager` | `leader`

**Organization/Department/Role**
- `state`: `active` | `deleted` (soft delete)

**HVT Problem**
- `status`: `identified` → `under_analysis` → `ideation` → `closed`

**HVT Idea**
- `status`: `draft` → `submitted` → `approved`/`rejected` → `in_progress`

**HVT Experiment** (State Machine)
```
seeded ──→ probing ──→ active ──→ logging ──→ ready_for_hash ──→ completed
                └────────────────────────────────────────────────→ halted
```

**HVT Escalation**
- `status`: `open` → `in_progress` → `resolved`

---

## Entity Relationships

```
Organization
├─ Departments (hierarchical via parentDepartmentId)
├─ Roles (org-level or dept-scoped)
├─ Members (via Membership)
│  └─ User (uid)
└─ HVT Modules
    ├─ Problems (per module)
    │  └─ Ideas (per problem)
    │     └─ Experiments (per idea)
    │        ├─ Results (measurements)
    │        ├─ Learnings (insights)
    │        ├─ Escalations (blockers)
    │        ├─ Tickets (tasks)
    │        └─ Updates (progress)
```

---

## Global Counters

All auto-incrementing IDs tracked via:
```
global:nextOrgId             global:nextHVTModuleId
global:nextDeptId            global:nextHVTProblemId
global:nextRoleId            global:nextHVTIdeaId
global:nextMembershipId      global:nextHVTExperimentId
                             global:nextHVTResultId
                             global:nextHVTLearningId
                             global:nextHVTEscalationId
                             global:nextHVTTicketId
                             global:nextHVTUpdateId
```

---

## Debugging Queries

### Find all members in organization
```javascript
const memberIds = await db.getSetMembers(`organization:123:members:active`)
const members = await db.getUsers(memberIds)
```

### Find user's organizations
```javascript
const orgIds = await db.getSetMembers(`uid:user1:organizations`)
const orgs = await db.getOrganizations(orgIds)
```

### Get active experiments
```javascript
const expIds = await db.getSortedSetRevRange(`hvt:experiments:org:123:sorted`, 0, 99)
const experiments = await db.getHVTExperiments(expIds)
```

### Check if user is organization manager
```javascript
const isManager = await db.isMember(`organization:123:managers`, uid)
```

### Get problem with all ideas
```javascript
const problem = await db.getHVTProblem(problemId)
const ideaIds = await db.getSetMembers(`hvt:ideas:problem:${problemId}`)
const ideas = await db.getHVTIdeas(ideaIds)
```

---

## Common Operations

### Create membership
```javascript
await db.createMembership(orgId, uid, {
  departmentId: "456",
  type: "member",
  roleId: "789"
})
// Auto-adds to:
//  - organization:123:members:active
//  - uid:user1:memberships:active
//  - department:456:members:active
```

### Update experiment status
```javascript
await db.updateHVTExperiment(experimentId, {
  status: "logging"  // Enforces state machine
})
```

### Remove member
```javascript
await db.removeMembership(membershipId)
// Auto-removes from all :active indices
// Sets status to 'removed' with timestamp
```

### Get full organization data
```javascript
const org = await db.getOrganization(orgId)
const deptIds = await db.getSetMembers(`organization:${orgId}:departments`)
const departments = await db.getDepartments(deptIds)
const memberIds = await db.getSetMembers(`organization:${orgId}:members:active`)
const members = await db.getUsers(memberIds)
```

---

## Key Patterns Summary

| Pattern | Example | Use |
|---------|---------|-----|
| Entity | `organization:123` | Get/store |
| Active Set | `organization:123:members:active` | List active |
| Sorted | `organization:123:members:sorted` | Paginate |
| Filter | `hvt:experiments:status:active` | Filter by state |
| Relationship | `hvt:ideas:problem:1` | Find children |
| User Scope | `uid:user1:memberships:active` | User view |

---

## Collections Used

- **MongoDB `organizations`** - Organizations, Departments, Roles, Memberships
- **MongoDB `hvt`** - All HVT entities (Modules, Problems, Ideas, Experiments, etc.)

**Note:** This schema covers CUSTOM business entities only. Auth/user management handled by NodeBB integration.

---

**Last Updated:** April 6, 2026  
**Schema Version:** 4.7.0  
**Database:** MongoDB (primary), PostgreSQL (legacy support)

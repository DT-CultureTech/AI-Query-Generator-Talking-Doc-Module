# Backend Custom Entities - Database CRUD Operations & Key Patterns

**Version:** 1.0  
**Date:** April 6, 2026  
**Database:** MongoDB (hvt collection), PostgreSQL (legacy_* tables)  
**Source Files:**
- `backend/src/database/mongo/organizations.js` - Organizations, Departments, Roles, Memberships
- `backend/src/database/mongo/hvt.js` - HVT system entities
- `backend/src/organizations/` - Business logic layer

---

## Overview

The backend tracks custom business entities organized into **two main categories**:

1. **Organizational Structure** (Organizations, Departments, Roles, Memberships)
2. **HVT (High Value Thinking) System** (Modules, Problems, Ideas, Experiments, Learnings, Escalations, Results, Tickets, Updates)

All entities use an **auto-incrementing ID pattern** with a global counter and **colon-separated key naming convention**.

---

# PART 1: ORGANIZATIONAL ENTITIES

## 1. Organizations

### Description
Top-level organizational unit representing a company/enterprise.

### Key Pattern
```
organization:{orgId}
```

### Database Collection
- **MongoDB Collection**: `organizations`
- **Storage Type**: Hash/JSONB object
- **Global Counter**: `global:nextOrgId`

### Fields & Data Types
```javascript
{
  _key: "organization:123",           // System key
  orgId: "123",                       // Unique org identifier (string)
  name: "Acme Corp",                  // Organization name
  sector: "Technology",               // Industry sector
  website: "https://acme.com",        // Website URL
  about: "Company description",       // About/bio
  employeeRange: "1000-5000",         // Employee count range
  emails: ["contact@acme.com"],       // Contact emails (array)
  phoneNumbers: ["+1-555-0123"],      // Phone numbers (array)
  locations: ["San Francisco, CA"],   // Office locations (array)
  socialLinks: {                      // Social media links
    linkedin: "url",
    twitter: "url"
  },
  leaders: ["uid1", "uid2"],          // Leader UIDs (array)
  images: {                           // Org images/branding
    logo: "url",
    banner: "url"
  },
  state: "active",                    // Status: active|deleted
  timestamp: 1704067200000,           // Creation timestamp
  lastmodified: 1704067200000,        // Last modified timestamp
  lastmodifiedBy: "uid99"             // UID of last modifier
}
```

### CRUD Operations

#### Create
```javascript
module.createOrganization(data)
// Input: { name, sector, website, about, employeeRange, emails, phoneNumbers, locations, socialLinks, leaders, images, createdBy }
// Returns: Organization object
// Side Effects:
//   - Increments global:nextOrgId counter
//   - Adds to sorted set: organizations:sorted (by timestamp)
//   - Adds to set: organizations:active
//   - If sector provided, adds to: organizations:sector:{sector}
```

#### Read
```javascript
module.getOrganization(orgId)              // Single org
module.getOrganizations(orgIds[])          // Multiple orgs (array)
module.getOrganizationsFields(orgIds[], fields)  // Specific fields only
module.getOrganizationField(orgId, field)  // Single field
```

#### Update
```javascript
module.updateOrganization(orgId, data)
// Auto-updates lastmodified and lastmodifiedBy
// Input: Partial data object with fields to update
// Returns: Updated organization object
```

#### Delete
```javascript
module.deleteOrganization(orgId)
// Sets state to 'deleted' (soft delete)
// Removes from organizations:active set
```

#### Query Operations
```javascript
module.isOrganizationActive(orgId)  // Check if active
```

### Index Keys
```
organizations:sorted                    // Sorted set: orgId → timestamp
organizations:active                   // Set: Active org IDs
organizations:sector:{sector}          // Set: Org IDs by sector
```

### Relationships
- **Parent of**: Departments, Roles, Memberships
- **Members**: via Membership entities
- **Managers/Leaders**: UIDs in arrays or via membership type

---

## 2. Departments

### Description
Organizational subdivisions within an organization. Support hierarchical structure (parent-child).

### Key Pattern
```
department:{deptId}
```

### Database Collection
- **MongoDB Collection**: `organizations`
- **Storage Type**: Hash/JSONB object
- **Global Counter**: `global:nextDeptId`

### Fields & Data Types
```javascript
{
  _key: "department:456",             // System key
  deptId: "456",                      // Unique dept identifier (string)
  organizationId: "123",              // Parent organization ID
  name: "Engineering",                // Department name
  description: "Software engineering team",  // Description
  parentDepartmentId: null,           // Parent dept ID (for hierarchy)
  level: 0,                           // Hierarchy level (0-n)
  state: "active",                    // Status: active|deleted
  timestamp: 1704067200000,           // Creation timestamp
  lastmodified: 1704067200000,        // Last modified timestamp
  lastmodifiedBy: "uid99"             // UID of last modifier
}
```

### CRUD Operations

#### Create
```javascript
module.createDepartment(orgId, data)
// Input: { name, description, parentDepartmentId, level, createdBy }
// Returns: Department object
// Side Effects:
//   - Increments global:nextDeptId
//   - Adds to sorted set: organization:{orgId}:departments:sorted
//   - Adds to set: organization:{orgId}:departments
//   - If parentDepartmentId, adds to: department:{parentDeptId}:children
```

#### Read
```javascript
module.getDepartment(deptId)                          // Single dept
module.getDepartments(deptIds[])                      // Multiple depts
module.getDepartmentsFields(deptIds[], fields)        // Specific fields
module.getOrganizationDepartments(orgId, start, stop) // Paginated by org
module.getDepartmentField(deptId, field)              // Single field
```

#### Update
```javascript
module.updateDepartment(deptId, data)
// Auto-updates lastmodified and lastmodifiedBy
```

#### Delete
```javascript
module.deleteDepartment(deptId)
// Sets state to 'deleted' (soft delete)
// Removes from organization's department set
// Removes from parent department's children set
```

### Index Keys
```
organization:{orgId}:departments:sorted    // Sorted set: deptId → timestamp
organization:{orgId}:departments           // Set: All dept IDs in org
department:{deptId}:children                // Set: Child dept IDs
department:{deptId}:members:active         // Set: Active member UIDs
department:{deptId}:members:sorted         // Sorted set: uid → timestamp
department:{deptId}:managers                // Set: Manager UIDs
department:{deptId}:roles                   // Set: Role IDs in dept
```

### Relationships
- **Parent**: Organization
- **Children**: Other departments (via parentDepartmentId)
- **Members**: User UIDs (with many-to-many via Membership)
- **Managers**: subset of members
- **Roles**: Role entities scoped to department

---

## 3. Roles

### Description
Job titles/positions within an organization or department.

### Key Pattern
```
role:{roleId}
```

### Database Collection
- **MongoDB Collection**: `organizations`
- **Storage Type**: Hash/JSONB object
- **Global Counter**: `global:nextRoleId`

### Fields & Data Types
```javascript
{
  _key: "role:789",                   // System key
  roleId: "789",                      // Unique role identifier (string)
  organizationId: "123",              // Scope organization
  departmentId: null,                 // Optional: scope to department
  name: "Senior Engineer",            // Role name/title
  description: "Senior engineering role",  // Role description
  scope: "organization",              // Scope: organization|department
  state: "active",                    // Status: active|deleted
  timestamp: 1704067200000,           // Creation timestamp
  lastmodified: 1704067200000,        // Last modified timestamp
  lastmodifiedBy: "uid99"             // UID of last modifier
}
```

### CRUD Operations

#### Create
```javascript
module.createRole(orgId, data)
// Input: { name, description, scope, departmentId, createdBy }
// Returns: Role object
// Side Effects:
//   - Increments global:nextRoleId
//   - Adds to sorted set: organization:{orgId}:roles:sorted
//   - Adds to set: organization:{orgId}:roles
//   - If departmentId, adds to: department:{deptId}:roles
```

#### Read
```javascript
module.getRole(roleId)                              // Single role
module.getRoles(roleIds[])                          // Multiple roles
module.getRolesFields(roleIds[], fields)            // Specific fields
module.getOrganizationRoles(orgId, start, stop)     // Paginated by org
module.getRoleField(roleId, field)                  // Single field
```

#### Update
```javascript
module.updateRole(roleId, data)
// Auto-updates lastmodified and lastmodifiedBy
```

#### Delete
```javascript
module.deleteRole(roleId)
// Sets state to 'deleted' (soft delete)
// Removes from organization's roles set
// Removes from department's roles set if scoped
```

### Index Keys
```
organization:{orgId}:roles:sorted       // Sorted set: roleId → timestamp
organization:{orgId}:roles              // Set: All role IDs in org
department:{deptId}:roles               // Set: Role IDs in dept (if scoped)
```

### Relationships
- **Organization**: Single parent organization
- **Department**: Optional scope to specific department
- **Memberships**: Users assigned roles via Membership.roleId

---

## 4. Memberships

### Description
Join table representing a user's affiliation with an organization, department, and/or role.

### Key Pattern
```
membership:{membershipId}
```

### Database Collection
- **MongoDB Collection**: `organizations`
- **Storage Type**: Hash/JSONB object
- **Global Counter**: `global:nextMembershipId`

### Fields & Data Types
```javascript
{
  _key: "membership:111",             // System key
  membershipId: "111",                // Unique membership ID (string)
  uid: "user1",                       // User ID
  organizationId: "123",              // Organization ID
  departmentId: "456",                // Optional: Department ID
  type: "member",                     // member|manager|leader
  roleId: "789",                      // Optional: Role ID
  status: "active",                   // active|removed
  joinedAt: 1704067200000,            // Join timestamp
  removedAt: null,                    // Removal timestamp (null if active)
  timestamp: 1704067200000,           // Creation timestamp
  lastmodified: 1704067200000,        // Last modified timestamp
}
```

### CRUD Operations

#### Create
```javascript
module.createMembership(orgId, uid, data)
// Input: { departmentId, type, roleId, createdBy }
// Returns: Membership object
// Side Effects:
//   - Increments global:nextMembershipId
//   - Adds to set: uid:{uid}:memberships:active
//   - Adds to set: uid:{uid}:organizations
//   - Adds to set: organization:{orgId}:members:active
//   - Adds to sorted set: organization:{orgId}:members:sorted
//   - If type=manager, adds to: organization:{orgId}:managers
//   - If type=leader, adds to: organization:{orgId}:leaders
//   - If departmentId, adds to: department:{deptId}:members:active and :sorted
//   - If dept + manager, adds to: department:{deptId}:managers
```

#### Read
```javascript
module.getMembership(membershipId)                               // Single membership
module.getMemberships(membershipIds[])                           // Multiple memberships
module.getMembershipsFields(membershipIds[], fields)             // Specific fields
module.getUserMembershipInOrganization(orgId, uid)               // User's memberships in org
module.getUserOrganizationsWithDetails(uid)                      // All user's orgs with details
```

#### Update
```javascript
module.updateMembership(membershipId, data)
// Smart handling of type/department changes with automatic index updates
// Input: Partial data (type, departmentId, roleId, etc.)
// Returns: Updated membership object
// Side Effects: Auto-manages membership type/department set migrations
```

#### Delete
```javascript
module.removeMembership(membershipId)
// Sets status to 'removed' and removedAt timestamp
// Removes from all active membership indices
// Side Effects:
//   - Removes from: uid:{uid}:memberships:active
//   - Removes from: organization:{orgId}:members:active
//   - Removes from: department:{deptId}:members:active (if applicable)
//   - Removes from: organization:{orgId}:managers (if type=manager)
//   - Removes from: organization:{orgId}:leaders (if type=leader)
//   - Cleans up organization affiliation if no other memberships
```

#### Query Operations
```javascript
module.isMember(orgId, uid)                     // Is user a member?
module.isManager(orgId, uid)                    // Is user a manager in org?
module.isLeader(orgId, uid)                     // Is user a leader in org?
module.isDepartmentMember(deptId, uid)          // Is user in dept?
module.isDepartmentManager(deptId, uid)         // Is user dept manager?
```

### Index Keys
```
uid:{uid}:memberships:active                   // Set: Active membership IDs
uid:{uid}:organizations                         // Set: Organization IDs user belongs to
organization:{orgId}:members:active            // Set: Active member UIDs
organization:{orgId}:members:sorted            // Sorted set: uid → joinTimestamp
organization:{orgId}:managers                  // Set: Manager UIDs
organization:{orgId}:leaders                   // Set: Leader UIDs
department:{deptId}:members:active             // Set: Member UIDs in dept
department:{deptId}:members:sorted             // Sorted set: uid → joinTimestamp
department:{deptId}:managers                   // Set: Manager UIDs in dept
```

### Relationships
- **User**: via uid
- **Organization**: orgId (required)
- **Department**: deptId (optional)
- **Role**: roleId (optional)

---

# PART 2: HVT (HIGH VALUE THINKING) SYSTEM ENTITIES

## Overview
The HVT system tracks the innovation process from problem identification through experimentation and learning capture.

**Entity Flow:**
```
Module → Problem → Idea → Experiment → Result/Learning
                               ├→ Escalation
                               └→ Ticket (for implementation)
```

---

## 5. HVT Module

### Description
High-level topic/domain within an organization for which problems/ideas/experiments are tracked.

### Key Pattern
```
hvt:module:{moduleId}
```

### Database Collection
- **MongoDB Collection**: `hvt`
- **Storage Type**: Hash/JSONB object
- **Global Counter**: `global:nextHVTModuleId`

### Fields & Data Types
```javascript
{
  _key: "hvt:module:1",               // System key
  id: "1",                            // Module ID (string)
  orgId: "123",                       // Organization scope
  name: "Customer Experience",        // Module name
  description: "Improving customer experience",  // Description
  color: "#6366F1",                   // UI color code
  createdAt: "2026-01-15T10:30:00Z",  // ISO timestamp
  updatedAt: "2026-01-15T10:30:00Z"   // ISO timestamp
}
```

### CRUD Operations

#### Create
```javascript
module.createHVTModule(data)
// Input: { name, description, color, orgId }
// Returns: Module object
// Side Effects:
//   - Increments global:nextHVTModuleId
//   - Adds to sorted set: hvt:modules:org:{orgId}:sorted
//   - Adds to sorted set: hvt:modules:sorted
```

#### Read
```javascript
module.getHVTModule(moduleId)                    // Single module
module.getHVTModules(moduleIds[])               // Multiple modules
module.getAllHVTModules()                       // All modules (globally)
module.getHVTModulesByOrg(orgId)                // Modules in organization
```

#### Update
```javascript
module.updateHVTModule(moduleId, data)
// Auto-updates updatedAt timestamp
// Returns: Updated module object
```

#### Delete
```javascript
module.deleteHVTModule(moduleId)
// Removes from all indices
// Note: Cascade delete of related problems/ideas/experiments depends on caller
```

### Index Keys
```
hvt:modules:org:{orgId}:sorted          // Sorted set: moduleId → timestamp
hvt:modules:sorted                      // Sorted set: moduleId → timestamp (global)
```

---

## 6. HVT Problem

### Description
Identifies a specific problem/challenge within a module that needs solving.

### Key Pattern
```
hvt:problem:{problemId}
```

### Database Collection
- **MongoDB Collection**: `hvt`
- **Storage Type**: Hash/JSONB object
- **Global Counter**: `global:nextHVTProblemId`

### Fields & Data Types
```javascript
{
  _key: "hvt:problem:101",            // System key
  id: "101",                          // Problem ID (string)
  orgId: "123",                       // Organization scope
  moduleId: "1",                      // Parent module
  title: "Long checkout process",     // Problem title
  description: "Customers abandon cart...",  // Detailed description
  severity: "high",                   // Severity level
  status: "open",                     // Status: open|resolved|wontfix
  problemType: "ux",                  // Type: ux|technical|business|etc
  affectedSurfaces: ["web", "mobile"], // Affected surfaces
  ideaCount: 0,                       // Idea counter
  createdBy: "uid1",                  // Problem submitter UID
  createdAt: "2026-01-16T09:00:00Z",  // ISO timestamp
  updatedAt: "2026-01-16T09:00:00Z"   // ISO timestamp
}
```

### CRUD Operations

#### Create
```javascript
module.createHVTProblem(data)
// Input: { moduleId, title, description, severity, status, problemType, affectedSurfaces, createdBy, orgId }
// Returns: Problem object
// Side Effects:
//   - Increments global:nextHVTProblemId
//   - Adds to sorted set: hvt:problems:org:{orgId}:sorted
//   - Adds to set: hvt:problems:module:{moduleId}
//   - Adds to set: hvt:problems:status:{status}
```

#### Read
```javascript
module.getHVTProblem(problemId)                      // Single problem (cached)
module.getHVTProblems(problemIds[])                  // Multiple problems
module.getHVTProblemsByOrg(orgId, start, stop)       // Paginated by org
module.getHVTProblemsByModule(moduleId)              // All in module
module.getHVTProblemCount(orgId)                     // Count in org
```

#### Update
```javascript
module.updateHVTProblem(problemId, data)
// Smart status change handling
// Input: Partial data including optional status
// Side Effects: Updates status sets if status changed
// Returns: Updated problem object
```

#### Delete
```javascript
module.deleteHVTProblem(problemId)
// Removes from all indices and cache
// Note: Cascade delete of related ideas depends on caller
```

### Index Keys
```
hvt:problems:org:{orgId}:sorted         // Sorted set: problemId → timestamp
hvt:problems:module:{moduleId}          // Set: Problem IDs in module
hvt:problems:status:{status}            // Set: Problem IDs by status
```

### Relationships
- **Module**: Parent module
- **Ideas**: One-to-many (ideaCount is counter)

---

## 7. HVT Idea

### Description
Proposed solution/approach to address a problem.

### Key Pattern
```
hvt:idea:{ideaId}
```

### Database Collection
- **MongoDB Collection**: `hvt`
- **Storage Type**: Hash/JSONB object
- **Global Counter**: `global:nextHVTIdeaId`

### Fields & Data Types
```javascript
{
  _key: "hvt:idea:201",               // System key
  id: "201",                          // Idea ID (string)
  orgId: "123",                       // Organization scope
  problemId: "101",                   // Parent problem
  title: "Simplified checkout",       // Idea title
  description: "One-click checkout experience",  // Description
  hypothesis: "Users will complete ... if ...",  // Hypothesis statement
  status: "pending_review",           // Status: draft|pending_review|in_review|approved|rejected|in_progress|completed
  impactScore: 8,                     // Impact (0-10)
  confidenceScore: 7,                 // Confidence (0-10)
  easeScore: 6,                       // Ease of implementation (0-10)
  totalScore: 21,                     // Aggregate score
  seededBy: "uid1",                   // Idea creator UID
  approvedBy: "uid2",                 // Approver UID (if approved)
  createdAt: "2026-01-17T14:00:00Z",  // ISO timestamp
  updatedAt: "2026-01-17T14:00:00Z"   // ISO timestamp
}
```

### CRUD Operations

#### Create
```javascript
module.createHVTIdea(data)
// Input: { problemId, title, description, hypothesis, status, scores..., seededBy, orgId }
// Returns: Idea object
// Side Effects:
//   - Increments global:nextHVTIdeaId
//   - Adds to sorted set: hvt:ideas:problem:{problemId}
//   - Adds to set: hvt:ideas:status:{status}
//   - Increments: hvt:metrics:org:{orgId}:ideaCount
//   - Invalidates org metrics cache
```

#### Read
```javascript
module.getHVTIdea(ideaId)                           // Single idea (cached)
module.getHVTIdeas(ideaIds[])                       // Multiple ideas
module.getHVTIdeasByProblem(problemId, start, stop) // Paginated by problem
module.getHVTIdeasByOrg(orgId, filters)             // By org with optional status filter
module.getHVTIdeaCount(orgId, problemId)            // Count
```

#### Update
```javascript
module.updateHVTIdea(ideaId, data)
// Smart status change handling
// Input: Partial data including optional status
// Side Effects: Updates status sets if status changed
// Returns: Updated idea object
```

#### Delete
```javascript
module.deleteHVTIdea(ideaId)
// Removes from all indices
// Decrements org metrics counter
// Invalidates caches
```

### Index Keys
```
hvt:ideas:problem:{problemId}           // Sorted set: ideaId → timestamp
hvt:ideas:status:{status}               // Set: Idea IDs by status
hvt:metrics:org:{orgId}                 // Metrics object with ideaCount
```

### Relationships
- **Problem**: Parent problem (required)
- **Experiments**: One-to-many (via ideaId)
- **Tickets**: One-to-many (for implementation tracking)

---

## 8. HVT Experiment

### Description
Structured test/trial of an idea with measurable outcomes.

### Key Pattern
```
hvt:experiment:{experimentId}
```

### Database Collection
- **MongoDB Collection**: `hvt`
- **Storage Type**: Hash/JSONB object
- **Global Counter**: `global:nextHVTExperimentId`

### Fields & Data Types
```javascript
{
  _key: "hvt:experiment:301",         // System key
  id: "301",                          // Experiment ID (string)
  orgId: "123",                       // Organization scope
  moduleId: "1",                      // Module scope
  problemId: "101",                   // Parent problem
  ideaId: "201",                      // Parent idea
  experimentNumber: "EXP-2026-001",   // Human-readable number
  title: "A/B test: one-click checkout",  // Experiment title
  ifStatement: "If we implement simplified checkout...",  // If/then structure
  thenStatement: "Then conversion rate increases by 15%...",
  status: "seeded",                   // seeded|running|halted|completed
  designedBy: "uid1",                 // Designer UID
  verifiedBy: "uid2",                 // Verifier UID (if verified)
  assignedTo: "uid3",                 // Assignee UID
  kpis: ["conversion_rate", "avg_time"],  // Key performance indicators
  executionNotes: "Started with 10% traffic...",  // Notes
  haltedBy: null,                     // UID if halted
  haltReason: null,                   // Halt reason
  resultCount: 0,                     // Result counter
  createdAt: "2026-01-18T10:00:00Z",  // ISO timestamp
  updatedAt: "2026-01-18T10:00:00Z"   // ISO timestamp
}
```

### CRUD Operations

#### Create
```javascript
module.createHVTExperiment(data)
// Input: { ideaId, problemId, moduleId, title, ifStatement, thenStatement, kpis, status, designedBy, verifiedBy, assignedTo, experimentNumber, orgId }
// Returns: Experiment object
// Side Effects:
//   - Increments global:nextHVTExperimentId
//   - Adds to sorted set: hvt:experiments:org:{orgId}:sorted
//   - Adds to sorted set: hvt:experiments:all
//   - Adds to set: hvt:experiments:idea:{ideaId}
//   - Adds to set: hvt:experiments:status:{status}
//   - Adds to sorted set: hvt:experiments:org:{orgId}:status:{status}
//   - Adds to sorted set: hvt:experiments:org:{orgId}:module:{moduleId} (if moduleId)
```

#### Read
```javascript
module.getHVTExperiment(experimentId)                           // Single experiment (cached)
module.getHVTExperiments(experimentIds[])                       // Multiple experiments
module.getHVTExperimentsByOrg(orgId, start, stop)               // Paginated by org
module.getHVTExperimentsByStatus(status, orgId, start, stop)    // By status (org-scoped)
module.getHVTExperimentsByModule(moduleId, orgId)               // By module
module.getHVTExperimentCount(orgId, status)                     // Count
```

#### Update
```javascript
module.updateHVTExperiment(experimentId, data)
// Smart status change handling with org-scoped index updates
// Input: Partial data including optional status
// Side Effects: Updates status sets, invalidates cache
// Returns: Updated experiment object
```

#### Delete
```javascript
module.deleteHVTExperiment(experimentId)
// Removes from all indices
// Note: Cascade delete of Results/Escalations depends on caller
```

### Index Keys
```
hvt:experiments:org:{orgId}:sorted                  // Sorted set: experimentId → timestamp
hvt:experiments:all                                 // Sorted set: experimentId → timestamp (global)
hvt:experiments:idea:{ideaId}                       // Set: Experiment IDs per idea
hvt:experiments:status:{status}                     // Set: Experiment IDs by status
hvt:experiments:org:{orgId}:status:{status}         // Sorted set: org-scoped status
hvt:experiments:org:{orgId}:module:{moduleId}       // Sorted set: org+module combo
```

### Relationships
- **Idea**: Parent idea (required)
- **Problem**: Parent problem (reference)
- **Module**: Parent module (reference)
- **Results**: One-to-many (resultCount counter)
- **Escalations**: One-to-many
- **Updates**: One-to-many (progress tracking)
- **Learning**: One-to-many

---

## 9. HVT Result

### Description
Measured outcome/metric from an experiment execution.

### Key Pattern
```
hvt:result:{resultId}
```

### Database Collection
- **MongoDB Collection**: `hvt`
- **Storage Type**: Hash/JSONB object
- **Global Counter**: `global:nextHVTResultId`

### Fields & Data Types
```javascript
{
  _key: "hvt:result:401",             // System key
  id: "401",                          // Result ID (string)
  experimentId: "301",                // Parent experiment
  loggedBy: "uid1",                   // Result logger UID
  description: "Week 1 results summary...",  // Result description
  outcome: "positive",                // Outcome: positive|neutral|negative
  metrics: {                          // Collected metrics
    conversion_rate: 0.18,
    avg_time: 45
  },
  createdAt: "2026-01-25T15:00:00Z"   // ISO timestamp
}
```

### CRUD Operations

#### Create
```javascript
module.createHVTResult(data)
// Input: { experimentId, description, outcome, metrics, loggedBy }
// Returns: Result object
// Side Effects:
//   - Increments global:nextHVTResultId
//   - Adds to sorted set: hvt:results:experiment:{experimentId}
//   - Increments resultCount in experiment object
```

#### Read
```javascript
module.getHVTResult(resultId)                      // Single result
module.getHVTResults(resultIds[])                  // Multiple results
module.getHVTResultsByExperiment(experimentId)     // All results for experiment
```

#### Delete
```javascript
module.deleteHVTResult(resultId)
// Simple removal from indices
```

### Index Keys
```
hvt:results:experiment:{experimentId}      // Sorted set: resultId → timestamp
```

### Relationships
- **Experiment**: Parent experiment

---

## 10. HVT Learning

### Description
Knowledge/insight extracted from an experiment for organizational learning.

### Key Pattern
```
hvt:learning:{learningId}
```

### Database Collection
- **MongoDB Collection**: `hvt`
- **Storage Type**: Hash/JSONB object
- **Global Counter**: `global:nextHVTLearningId`

### Fields & Data Types
```javascript
{
  _key: "hvt:learning:501",           // System key
  id: "501",                          // Learning ID (string)
  orgId: "123",                       // Organization scope
  experimentId: "301",                // Parent experiment
  moduleId: "1",                      // Module scope
  title: "Simple checkout increases conversion",  // Learning title
  description: "After testing simplified checkout...learned that...",  // Learning description
  caveat: "Effect only observed on mobile",  // Important caveats
  persona: "mobile_user",             // Target persona
  isHashed: false,                    // Is personally identifiable data hashed?
  outcomeType: "conversion",          // Type: conversion|engagement|etc
  tags: ["checkout", "conversion", "mobile"],  // Learning tags
  createdBy: "uid1",                  // Learning author UID
  createdAt: "2026-01-28T10:00:00Z",  // ISO timestamp
  updatedAt: "2026-01-28T10:00:00Z"   // ISO timestamp
}
```

### CRUD Operations

#### Create
```javascript
module.createHVTLearning(data)
// Input: { experimentId, title, description, caveat, persona, isHashed, outcomeType, tags, moduleId, createdBy, orgId }
// Returns: Learning object
// Side Effects:
//   - Increments global:nextHVTLearningId
//   - Adds to sorted set: hvt:learnings:org:{orgId}:sorted
//   - Adds to sorted set: hvt:learnings:module:{moduleId}:sorted (if moduleId)
//   - For each tag, adds to: hvt:learnings:tag:{tag}:org:{orgId}
```

#### Read
```javascript
module.getHVTLearning(learningId)                           // Single learning (cached)
module.getHVTLearnings(learningIds[])                       // Multiple learnings
module.getHVTLearningsByOrg(orgId, start, stop)             // Paginated by org
module.getHVTLearningsByModule(moduleId, start, stop)       // Paginated by module
module.getHVTLearningsByTag(tag, orgId, start, stop)        // By tag (org-scoped)
module.getHVTLearningCount(orgId)                           // Count in org
```

#### Update
```javascript
module.updateHVTLearning(learningId, data)
// Updates learning, invalidates cache
// Returns: Updated learning object
```

#### Delete
```javascript
module.deleteHVTLearning(learningId)
// Removes from all indices and cache
// Cleans up tag indices
```

### Index Keys
```
hvt:learnings:org:{orgId}:sorted                    // Sorted set: learningId → timestamp
hvt:learnings:module:{moduleId}:sorted              // Sorted set: learningId → timestamp
hvt:learnings:tag:{tag}:org:{orgId}                 // Sorted set: learningId → timestamp (per tag)
```

### Relationships
- **Experiment**: Parent experiment
- **Module**: Scope module
- **Organization**: Scope organization

---

## 11. HVT Escalation

### Description
Issue or blocker encountered during experiment execution that requires attention/resolution.

### Key Pattern
```
hvt:escalation:{escalationId}
```

### Database Collection
- **MongoDB Collection**: `hvt`
- **Storage Type**: Hash/JSONB object
- **Global Counter**: `global:nextHVTEscalationId`

### Fields & Data Types
```javascript
{
  _key: "hvt:escalation:601",         // System key
  id: "601",                          // Escalation ID (string)
  orgId: "123",                       // Organization scope
  experimentId: "301",                // Parent experiment
  reason: "Traffic limit reached",    // Escalation reason
  severity: "high",                   // critical|high|medium|low
  status: "open",                     // open|resolved|closed
  raisedBy: "uid1",                   // Escalation raiser UID
  assignedTo: "uid2",                 // Assigned to UID
  resolvedBy: null,                   // Resolver UID (if resolved)
  createdAt: "2026-01-20T11:00:00Z",  // ISO timestamp
  resolvedAt: null                    // ISO timestamp (if resolved)
}
```

### CRUD Operations

#### Create
```javascript
module.createHVTEscalation(data)
// Input: { experimentId, reason, severity, status, raisedBy, assignedTo, orgId }
// Returns: Escalation object
// Side Effects:
//   - Increments global:nextHVTEscalationId
//   - Adds to sorted set: hvt:escalations:experiment:{experimentId}
//   - Adds to sorted set: hvt:escalations:org:{orgId}:status:{status}
```

#### Read
```javascript
module.getHVTEscalation(escalationId)               // Single escalation (cached)
module.getHVTEscalations(escalationIds[])           // Multiple escalations
module.getHVTEscalationsByExperiment(experimentId)  // All for experiment
```

#### Update
```javascript
module.updateHVTEscalation(escalationId, data)
// Smart status change handling
// Auto-sets resolvedAt if status→resolved
// Invalidates cache
// Returns: Updated escalation object
```

#### Delete
```javascript
module.deleteHVTEscalation(escalationId)
// Removes from all indices and cache
```

### Index Keys
```
hvt:escalations:experiment:{experimentId}               // Sorted set: escalationId → timestamp
hvt:escalations:org:{orgId}:status:{status}            // Sorted set: escalationId → timestamp
```

### Relationships
- **Experiment**: Parent experiment

---

## 12. HVT Ticket

### Description
External ticket/issue reference for implementing an idea (e.g., Jira, GitHub issue).

### Key Pattern
```
hvt:ticket:{ticketId}
```

### Database Collection
- **MongoDB Collection**: `hvt`
- **Storage Type**: Hash/JSONB object
- **Global Counter**: `global:nextHVTTicketId`

### Fields & Data Types
```javascript
{
  _key: "hvt:ticket:701",             // System key
  id: "701",                          // Ticket ID (string)
  orgId: "123",                       // Organization scope
  ideaId: "201",                      // Associated idea
  externalTicketId: "PROJ-1234",      // External system ID (e.g., Jira key)
  ticketSystem: "jira",               // Ticket system: jira|github|etc
  ticketUrl: "https://jira.company.com/browse/PROJ-1234",  // Link to ticket
  createdBy: "uid1",                  // Creator UID
  createdAt: "2026-01-21T09:00:00Z"   // ISO timestamp
}
```

### CRUD Operations

#### Create
```javascript
module.createHVTTicket(data)
// Input: { ideaId, externalTicketId, ticketSystem, ticketUrl, createdBy, orgId }
// Returns: Ticket object
// Side Effects:
//   - Increments global:nextHVTTicketId
//   - Adds to sorted set: hvt:tickets:idea:{ideaId}
```

#### Read
```javascript
module.getHVTTicket(ticketId)                  // Single ticket
module.getHVTTickets(ticketIds[])              // Multiple tickets
module.getHVTTicketsByIdea(ideaId)             // All tickets for idea
```

#### Delete
```javascript
module.deleteHVTTicket(ticketId)
// Removes from idea's ticket list
```

### Index Keys
```
hvt:tickets:idea:{ideaId}               // Sorted set: ticketId → timestamp
```

### Relationships
- **Idea**: Parent idea

---

## 13. HVT Update

### Description
Progress update/note on an experiment execution (e.g., "Week 1 progress").

### Key Pattern
```
hvt:update:{updateId}
```

### Database Collection
- **MongoDB Collection**: `hvt`
- **Storage Type**: Hash/JSONB object
- **Global Counter**: `global:nextHVTUpdateId`

### Fields & Data Types
```javascript
{
  _key: "hvt:update:801",             // System key
  id: "801",                          // Update ID (string)
  experimentId: "301",                // Parent experiment
  content: "Week 1: Setup complete, starting traffic routing...",  // Update content
  updateType: "progress",             // Type: progress|milestone|risk|etc
  postedBy: "uid1",                   // Poster UID
  createdAt: "2026-01-22T10:00:00Z"   // ISO timestamp
}
```

### CRUD Operations

#### Create
```javascript
module.createHVTUpdate(data)
// Input: { experimentId, content, updateType, postedBy }
// Returns: Update object
// Side Effects:
//   - Increments global:nextHVTUpdateId
//   - Adds to sorted set: hvt:updates:experiment:{experimentId}
```

#### Read
```javascript
module.getHVTUpdate(updateId)                   // Single update
module.getHVTUpdates(updateIds[])               // Multiple updates
module.getHVTUpdatesByExperiment(experimentId)  // All updates for experiment
```

### Index Keys
```
hvt:updates:experiment:{experimentId}        // Sorted set: updateId → timestamp
```

### Relationships
- **Experiment**: Parent experiment

---

## 14. HVT User Role

### Description
User's specific role within the HVT system (separate from organizational role).

### Key Pattern
```
hvt:role:{orgId}:{uid}
```

### Database Collection
- **MongoDB Collection**: `hvt`
- **Storage Type**: Hash/JSONB object
- **Global Counter**: None (generated from orgId + uid)

### Fields & Data Types
```javascript
{
  _key: "hvt:role:123:uid1",          // System key
  id: "123-uid1",                     // Composite ID
  userId: "uid1",                     // User ID
  orgId: "123",                       // Organization
  role: "innovator",                  // Role: innovator|reviewer|designer|etc
  createdAt: "2026-01-15T10:00:00Z"   // ISO timestamp
}
```

### CRUD Operations

#### Create/Update
```javascript
module.setHVTUserRole(uid, orgId, role)
// Input: uid, orgId, role
// Returns: Role object
// Side Effects:
//   - Adds to set: hvt:roles:org:{orgId}
//   - Adds to set: hvt:roles:user:{uid}
```

#### Read
```javascript
module.getHVTUserRole(uid, orgId)              // Get user's HVT role in org (returns role string)
module.getHVTRolesByOrg(orgId)                 // All users with HVT roles in org
```

#### Delete
```javascript
module.deleteHVTUserRole(uid, orgId)
// Removes from indices
```

### Index Keys
```
hvt:roles:org:{orgId}                   // Set: User IDs with HVT roles in org
hvt:roles:user:{uid}                    // Set: Organization IDs where user has HVT role
```

---

# PART 3: GLOBAL COUNTERS

Entity ID generation uses auto-incrementing global counters:

```
global:nextOrgId                  // Organization counter
global:nextDeptId                 // Department counter
global:nextRoleId                 // Role counter
global:nextMembershipId           // Membership counter
global:nextHVTModuleId            // HVT Module counter
global:nextHVTProblemId           // HVT Problem counter
global:nextHVTIdeaId              // HVT Idea counter
global:nextHVTExperimentId        // HVT Experiment counter
global:nextHVTResultId            // HVT Result counter
global:nextHVTLearningId          // HVT Learning counter
global:nextHVTEscalationId        // HVT Escalation counter
global:nextHVTTicketId            // HVT Ticket counter
global:nextHVTUpdateId            // HVT Update counter
```

All counters are string values stored in `legacy_string` table and accessed via:
```javascript
module.incrObjectField('global', 'nextOrgId')  // Returns next ID as number
```

---

# PART 4: ENTITY RELATIONSHIPS DIAGRAM

```
┌─────────────────────────────────────────────────────────────┐
│                    USER (NodeBB)                                │
│                      uid: "123"                              │
└──────────────────────────┬──────────────────────────────────┐
                           │
                           │ 1-to-many
                           ↓
         ┌─────────────────────────────────┐
         │      MEMBERSHIP                     │
         │  id: membershipId                │
         │  uid, orgId, deptId, roleId     │
         │  type: member|manager|leader     │
         └────┬──────────┬─────────┬────────┘
              │          │         │
      ┌───────┘   ┌──────┘    ┌───┘
      ↓           ↓           ↓
┌──────────┐  ┌──────────┐  ┌─────────┐
│  ORG     │  │  DEPT    │  │  ROLE   │
│ orgId    │  │ deptId   │  │ roleId  │
└──────────┘  └──────────┘  └─────────┘
      │
      │ 1-to-many
      │ contains
      ↓
 ┌─────────────────┐
 │  DEPARTMENT     │  (hierarchy: parent-child)
 │  deptId         │
 │  orgId (FK)     │
 └─────────────────┘

HVT SYSTEM:
    ┌────────────────────────────────────────┐
    │    HVT MODULE                          │
    │    moduleId, orgId                     │
    └────────────┬─────────────────────────┘
                 │ 1-to-many
                 ↓
         ┌───────────────────┐
         │  HVT PROBLEM      │
         │  problemId, orgId │
         └────────┬──────────┘
                  │ 1-to-many (ideaCount counter)
                  ↓
          ┌──────────────────┐
          │  HVT IDEA        │
          │  ideaId, orgId   │
          └──────┬───────────┘
                 │ 1-to-many
         ┌───────┴──────────┐
         │                  │
         ↓                  ↓
    ┌──────────────┐  ┌──────────────┐
    │HVT EXPERIMENT│  │ HVT TICKET   │ (external reference)
    │experimentId  │  │ ticketId     │
    │ orgId        │  │ ticketSystem │
    └──────┬───────┘  └──────────────┘
           │
         1-to-many
    ┌──────┴──────┬─────────┬──────────┐
    ↓             ↓         ↓          ↓
┌─────────┐ ┌────────┐ ┌──────────┐ ┌────────┐
│ RESULT  │ │ UPDATE │ │ESCALATION│ │LEARNING│
│resultId │ │updateId│ │escalId   │ │learningId│
└─────────┘ └────────┘ └──────────┘ └────────┘
```

---

# PART 5: COLLECTION STORAGE

### MongoDB Collections Used

1. **`organizations`** - Stores: Organization, Department, Role, Membership objects
   - Keys: `organization:*`, `department:*`, `role:*`, `membership:*`

2. **`hvt`** - Stores: All HVT-related objects
   - Keys: `hvt:module:*`, `hvt:problem:*`, `hvt:idea:*`, `hvt:experiment:*`, `hvt:result:*`, `hvt:learning:*`, `hvt:escalation:*`, `hvt:ticket:*`, `hvt:update:*`, `hvt:role:*`

### PostgreSQL Legacy Tables Used

- **`legacy_hash`** - Stores all object data (JSONB)
- **`legacy_zset`** - Stores sorted indices (by timestamp)
- **`legacy_set`** - Stores relationship sets (unordered collections)
- **`legacy_object`** - Master index tracking all objects

---

# PART 6: KEY OPERATIONAL PATTERNS

### Pagination Pattern
```javascript
// Most .getBy*Org() methods support pagination:
module.getOrganizationDepartments(orgId, start, stop)
// Uses: getSortedSetRevRange(key, start, stop)
// start/stop are array indices (0-based)
// Returns: Array of entities
```

### Status/Type Set Management
```javascript
// When status/type changes, old index is removed and new added:
// Old: hvt:problems:status:open
// New: hvt:problems:status:resolved
// Automatically handled in update operations
```

### Caching Pattern (HVT entities)
```javascript
// HVT objects use LRU cache (30-min TTL, max 5000 items)
module.getHVTModule(moduleId)  // Checks cache first, then DB
// Cache is invalidated on update/delete
```

### Multi-tenant Pattern (Organization-scoped)
```javascript
// Most HVT indices are organization-scoped for isolation:
hvt:modules:org:{orgId}:sorted
hvt:problems:org:{orgId}:sorted
hvt:experiments:org:{orgId}:status:{status}
// Ensures data isolation and efficient querying
```

---

**End of Document**

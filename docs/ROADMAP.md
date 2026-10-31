# SavoryBites — Development Roadmap & Milestone Tracker

## 1. Project Overview & Architectural Foundation

SavoryBites is a production-grade restaurant digital ordering and operational management platform engineered for table service (dine-in) and counter pickup (takeout).

### Technology Stack
- **Frontend**: Next.js 16.4.2 (App Router, Turbopack, React 19, TypeScript 5, Tailwind CSS v4, CSS Modules)
- **Backend API**: FastAPI (Python 3.12, Pydantic v2, SQLAlchemy 2.0, Uvicorn)
- **Database**: PostgreSQL 17 (`restaurant_db` local, `restaurant_db_staging` staging)
- **Fulfillment Models**: `table_service` (dine-in table assignment), `counter_pickup` (takeout collection)

---

## 2. Milestone Execution History

| Milestone ID | Feature Area | Scope Summary | Status |
|---|---|---|---|
| **SB-001** | Core Architecture & Scaffolding | Next.js frontend, FastAPI backend, PostgreSQL schema | **VERIFIED & COMPLETED** |
| **SB-002** | Customer Authentication & Sessions | JWT authentication, secure cookies, bcrypt password hashing | **VERIFIED & COMPLETED** |
| **SB-003** | Menu Catalog & Category Navigation | Public menu catalog, categories, search, pricing | **VERIFIED & COMPLETED** |
| **SB-004** | Product Details & Customization | Dish sizing, add-ons, price modifiers, quantity controls | **VERIFIED & COMPLETED** |
| **SB-005** | Persistent Shopping Cart | Client cart provider, session persistence, limits | **VERIFIED & COMPLETED** |
| **SB-006** | Table & Fulfillment Selection | Dine-in table service selection, counter pickup choice | **VERIFIED & COMPLETED** |
| **SB-007** | Order Verification & Checkout | Server quote calculation, price validation, customer review | **VERIFIED & COMPLETED** |
| **SB-008** | Payment & Order Creation | Payment method selection, idempotency key, order creation | **VERIFIED & COMPLETED** |
| **SB-009** | Kitchen Display System (KDS) | Kitchen order queue, status progression, staff authorization | **VERIFIED & COMPLETED** |
| **SB-010** | Manager Menu Management (CRUD) | Category & product CRUD, availability toggles, manager RBAC | **VERIFIED & COMPLETED** |
| **SB-011** | Manager Inventory Management | Stock tracking, threshold alerts, manual adjustments, audit logs | **VERIFIED & COMPLETED** |
| **SB-012** | Customer Profile & Saved Addresses | Profile editing, multiple saved addresses, default address badge | **VERIFIED & COMPLETED** |
| **SB-013** | Customer Password Reset & Recovery | Time-limited tokens, rate limiting, anti-enumeration timing | **VERIFIED & COMPLETED** |
| **SB-014** | Informational & Brand Pages | About Us, Contact Us, FAQ, Restaurant Hours, Location | **VERIFIED & COMPLETED** |
| **SB-015** | Production Readiness & Hardening | Security headers, trusted proxy IP, error sanitization, DB health | **VERIFIED & COMPLETED** |
| **SB-016** | Independent Security Audit | Vulnerability remediation, test suite expansion (95 tests) | **VERIFIED & COMPLETED** |
| **SB-017** | Staging Infrastructure & Smoke Tests | Staging Docker compose, Nginx reverse proxy, 42/42 smoke tests | **VERIFIED & COMPLETED** |
| **SB-018** | **Comprehensive UI/UX Audit & Refinement** | Centralized design tokens, sticky header, active navigation, appetite-appealing cards, stepper checkout, unified manager header, KDS readability, WCAG 2.2 AA accessibility | **VERIFIED & COMPLETED** |
| **SB-019** | **Premium UX & Motion Design System** | Centralized motion tokens, hardware-accelerated micro-interactions, cart bump pulse, active navigation marker expansion, dish zoom transitions, accessible modal popovers, strict `prefers-reduced-motion` compliance | **VERIFIED & COMPLETED** |
| **SB-020** | **Menu Page UX Architecture Evaluation & Implementation** | Evaluated Option A vs. Option B; implemented 2-column layout with sticky left category rail on desktop (≥ 880px) and responsive horizontal rail on mobile; preserved sticky header cart visibility and bottom footer | **VERIFIED & COMPLETED** |
| **SB-021** | **Independent Menu UX Verification & Responsive Refinement** | Corrected in-scroll page jumps (`scroll: false`), eliminated vertical category clipping on short desktop viewports (`max-height: calc(100vh - 108px)`), preserved 2-column cards on tablet (≥ 640px), unified baseline card alignment (`.cardBody`), added mobile overscroll containment and active pill auto-centering, added ARIA live polite status announcements | **VERIFIED & COMPLETED** |
| **SB-022** | **Mobile Menu UX Redesign & Ordering Experience Optimization** | Resolved horizontal viewport overflow on mobile viewports (≤ 680px), optimized category pill navigation and spacing, unified search and availability filter toolbar with zero visual gaps, streamlined mobile product cards | **VERIFIED & COMPLETED** |
| **SB-023** | **Manager Menu & Inventory Management Audit, Enhancement & End-to-End Integration** | Comprehensive audit of SB-010 (Menu CRUD) and SB-011 (Inventory Management); implemented inline Category Editing in Manager portal (name, display order, description); verified real-time price & availability propagation to customer menu, cart, checkout quote recalculation, and KDS stock deduction | **VERIFIED & COMPLETED** |
| **SB-AUTH-001** | **Production-Grade Authentication Architecture & Unified Staff Login** | Server-enforced RBAC for staff login, separate manager and KDS credential validation, brute-force rate limiting, password visibility toggles, customer authentication isolation | **VERIFIED & COMPLETED** |
| **SB-AUTH-002** | **Unified Staff Login with Animated Manager/KDS Experiences** | Coordinated two-panel horizontal translation animation between Manager Login and KDS Login at `/staff/login`, responsive mobile tabs, screen reader polite announcements, server-authoritative post-login routing | **VERIFIED & COMPLETED** |

---

## 3. Next Eligible Milestone

### **SB-024: Production Go-Live Deployment, Custom Domain Verification & Live Telemetry**
- **Objective**: Execute final production cutover to public domains (e.g. `savorybites.ph` / `savorybites.com`).
- **Scope**:
  1. DNS provisioning & automated SSL/TLS termination with Let's Encrypt / Certbot.
  2. Production SMTP provider credential activation (SendGrid / Mailgun) for live transactional emails.
  3. Managed PostgreSQL cloud instance provisioning with automated backups and replication.
  4. Application performance monitoring (APM), structured logging, and uptime alerting.
  5. End-to-end production smoke test run against live domain.

# 1Minute Rewards — Full-stack starter

## Run
1. Install Node.js 20+.
2. In this folder run: `npm install`
3. Run: `npm start`
4. Open `http://localhost:3000`

This version connects User UI to an Express + SQLite backend. It includes registration/login, tasks, server-side one-time task completion, points, and withdrawal requests.

## Important
Admin routes shown here are intentionally NOT production-secured. Before public launch, add proper admin authentication/roles, CSRF protection where applicable, rate limiting, audit logs, HTTPS, password hashing with a modern password KDF (Argon2/bcrypt), secure session storage, server-side task verification, fraud controls, database backups, and legal/policy review.

No claim of guaranteed income is made. Rewards should only be funded by legitimate revenue and comply with the relevant ad/affiliate/payment platform rules.

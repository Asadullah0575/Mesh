# ⬡ GenLayer — Multi-Room AI Collaboration

Real-time collaborative workspace with Socket.IO and GenLayer AI (powered by Claude).

---

## Architecture

```
Frontend (React + Vite)  ←→  Backend (Node + Socket.IO)  ←→  Anthropic API
     localhost:3000               localhost:4000
```

---

## Quick Start

### 1. Backend

```bash
npm install
cp .env.example .env
# Edit .env — add your API keys (ANTHROPIC_API_KEY / GROQ_API_KEY, MONGODB_URI, etc.)
npm run dev
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env
# Edit .env — set VITE_SOCKET_URL=http://localhost:4000
npm run dev
```

Open http://localhost:3000 in two browser tabs to test multi-user.

---

## ⬡ GenLayer Intelligent Contract Integration

This project implements a working **GenLayer Intelligent Contract** that acts as an **On-Chain Bounty Adjudicator**. Users can post tasks with specific completion criteria, workers can submit text deliverables, and validators reach independent LLM consensus on-chain to evaluate the solution and award completion status — the poster's own opinion never decides the outcome.

- **Deployed at:** `0xeeE16B76C7296dC930c0a3E8b517429Ae1991d29`
- **Network:** Studionet, chain ID `61999`
- **Deployment tx hash:** `0x4daae1250ea7692324d9f78bf783cbd2ce1c72a04c15f60bd1c8e999fc7a5da1`

### Live evidence: a full task → submission → AI judgment cycle

Deployed and exercised end-to-end via the GenLayer CLI against the hosted
Studio network:

```bash
genlayer network set studionet
genlayer deploy --contract contracts/bounty_board.py
```

**1. Task created:**
```
genlayer write 0xeeE16B76C7296dC930c0a3E8b517429Ae1991d29 create_task \
  --args "Sort list" "Write a python function to sort a list of numbers." \
         "The function must sort a list of numbers in ascending order."
```

**2. Solution submitted:**
```
genlayer write 0xeeE16B76C7296dC930c0a3E8b517429Ae1991d29 submit_solution \
  --args 0 "def sort_list(arr): return sorted(arr)"
```

**3. Validators independently judged it** (`evaluate_submission`, which calls
`gl.eq_principle.prompt_non_comparative`), and reached consensus:

```
validator_votes: [ 1, 1, 5, 1, 5 ]
validator_votes_name: [ 'AGREE', 'AGREE', 'IDLE', 'AGREE', 'IDLE' ]
status_name: 'ACCEPTED'
```

3 of 5 validators actively agreed; 2 came back `IDLE`, and consensus still
reached `ACCEPTED` — a real data point about GenLayer's threshold behavior
under partial validator participation.

**4. Reading the task back afterward confirms the AI's actual verdict and
reasoning, stored on-chain:**

```
genlayer call 0xeeE16B76C7296dC930c0a3E8b517429Ae1991d29 get_task --args 0
```
```
{
  candidate: '0x581a09d1eac64bb9f7aef59c9c69d5c9d069024f',
  creator: '0x581a09d1eac64bb9f7aef59c9c69d5c9d069024f',
  criteria: 'The function must sort a list of numbers in ascending order.',
  deliverable: 'def sort_list(arr): return sorted(arr)',
  description: 'Write a python function to sort a list of numbers.',
  evaluation_result: 'The submitted deliverable defines a Python function,
    `sort_list(arr)`, which returns `sorted(arr)`. The `sorted()` function
    sorts a list of numbers in ascending order by default, so the
    deliverable satisfies the requirement to sort a list of numbers in
    ascending order.',
  id: 0,
  status: 'Completed',
  title: 'Sort list'
}
```

This is the full loop working for real: a task with plain-English criteria,
a submitted deliverable, validators independently running the same LLM
judgment and agreeing on it through consensus, and the contract recording
both the verdict and the AI's actual reasoning — not a mocked response.

### Prerequisite: Install the GenLayer CLI
Ensure you have Python 3.12+ and Node.js 18+ installed.
```bash
npm install -g genlayer
```

### Run contract unit tests
The smart contract includes a unit test that mocks the LLM validator
consensus locally using `genlayer-test`, for fast iteration without a live
network:
```bash
pip install genlayer-test
pytest tests/ -v
```

### Deploy your own copy

**Hosted Studio network (used for the evidence above, no Docker needed):**
```bash
genlayer network set studionet
genlayer account create --name deployer
genlayer deploy --contract contracts/bounty_board.py
```

**Or a local sandbox, if you'd rather iterate privately first:**
```bash
genlayer init
genlayer up
```
This starts a local GenLayer node and simulator. You can point MetaMask at it:
*   **Network Name**: GenLayer Localnet
*   **RPC URL**: `http://localhost:4000/api`
*   **Chain ID**: `61999`
*   **Currency Symbol**: `GEN`

Either way, copy the resulting contract address, open the frontend, click
the **Bounty Board** tab, paste it into the **Contract Address** field, and
click **Refresh**.

---

## Socket.IO Events

### Client → Server

| Event          | Payload                              | Description                    |
|----------------|--------------------------------------|--------------------------------|
| `join_room`    | `{ username, room }`                 | Join a collaboration room      |
| `send_message` | `{ room, text, username }`           | Send a message                 |
| `typing`       | `{ room, username, isTyping }`       | Broadcast typing status        |

### Server → Client

| Event          | Payload                              | Description                    |
|----------------|--------------------------------------|--------------------------------|
| `room_history` | `{ room, messages[] }`              | Last 50 messages on join       |
| `new_message`  | `{ room, message }`                 | New message (user or AI)       |
| `room_users`   | `{ room, users[] }`                 | Updated user list              |
| `user_joined`  | `{ username, room }`                | User entered room              |
| `user_left`    | `{ username, room }`                | User disconnected              |
| `user_typing`  | `{ username, isTyping }`            | Peer typing indicator          |
| `ai_typing`    | `{ room, typing }`                  | AI is generating response      |

---

## Triggering the AI

By default, prefix any message with `@ai` or `@genlayer` to get an AI response:

```
@ai what's the best approach for our GenLayer smart contract architecture?
```

To make AI respond to **every** message, set `AI_ALWAYS=true` in your backend `.env`.

---

## Rooms

| Room       | Purpose                     |
|------------|-----------------------------|
| `general`  | Open team discussion        |
| `research` | AI-assisted research        |
| `design`   | UI/UX collaboration         |
| `backend`  | API & infrastructure        |
| `deploy`   | DevOps & CI/CD              |

---

## Deployment

### Backend → Render
1. Push to GitHub
2. Create new **Web Service** on [render.com](https://render.com)
3. Set env vars: `ANTHROPIC_API_KEY`, `FRONTEND_URL`, `PORT`
4. Build command: `npm install` · Start command: `npm start`

### Frontend → Vercel
1. Push frontend folder to GitHub
2. Import on [vercel.com](https://vercel.com)
3. Set env var: `VITE_SOCKET_URL=https://your-backend.onrender.com`
4. Deploy

---

## Next Steps

- [ ] Add user authentication (JWT or wallet-based)
- [ ] Persist messages with Supabase or MongoDB
- [ ] Room creation / private rooms
- [ ] File sharing & code snippets
- [ ] AI memory across sessions
# Annual Function product implementation

The existing requirements in `../README.md` and `../annual_function_stack.md` define the product. The user authorized an uninterrupted implementation, starting with a modern dark interface.

## Design

The public landing page, student portal, staff login, and admin workspace share a playful paper-theatre identity: dark ink, butter yellow, lilac, peach and mint, Bricolage display typography, and Geist body text. The workspaces use pastel overview cards, paper-like forms, star navigation, a lilac printable invitation, a short entrance on view changes, and a user-triggered celebration. Reduced-motion preferences disable movement. Demo school, chief guests, and programme are editable in the staff workspace.

## Delivery sequence

- [x] Build the shared shell and student portal: event overview, invitation access, printable QR pass, guest registration/removal, event information, helpdesk, and support history.
- [x] Complete server rules: serialized guest capacity, active invitations, duplicate-safe guest check-in, scoped tickets, authenticated staff actions, validated input. Disable named prepared statements for the Supabase transaction pooler and verify entry persistence.
- [x] Build staff workspace: metrics, invitation/student creation and search, guest lists, QR/manual entry, ticket resolution, event settings and event knowledge.
- [x] Connect grounded assistance to configured OpenAI Responses API; provide clearly labelled official-information answers when AI is unavailable. External messaging remains credential-dependent and must never send messages during development.
- [x] Build the playful public landing page at `/`, move the family workspace to `/portal`, and provide editable demo content.
- [x] Verify with lint, TypeScript, production build, behavioral API checks using isolated test records, and desktop/mobile browser checks. Document setup and remaining external integrations in `running-the-product.md`.

## Boundaries

Keep the existing Next.js / Drizzle / PostgreSQL stack and dependencies. Invitation codes are private access credentials; new codes use cryptographic randomness. Staff use Supabase authentication with server-owned roles or an explicitly configured access key. Never expose all student tickets publicly. Do not deploy or send messages. Do not reset existing school records while testing.

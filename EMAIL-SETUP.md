# Connect your email service

Email is DIY: use your own provider and enter its settings in Boopity's wizard.
You do not need email working to **open setup with your setup password** (or an
initial private setup link).
You do need to receive and verify a code before creating the owner and finishing
setup. Google and online payments remain optional.

## Before you begin

- Open your own installation and unlock setup. See
  [opening the wizard](GUIDED-INSTALLATION.md).
- In **Your account**, save your name and an inbox you can check.
- The **owner email** receives login codes. The **sender email** sends them; it
  can be a different address, but your sending provider must authorize it.
- Check your provider's price, sending limits and recipient restrictions. Boopity
  does not include a mail account or pay provider charges on your behalf.

## Resend

1. In your own Resend account, add a domain you own. Follow the displayed DNS
   records and wait for verification. A shared hosting address or Gmail address
   is not your sending domain. Do not remove records that serve an existing inbox.
2. Create a **sending-only** API key restricted to that domain; keep it private.
3. In Boopity's **Email delivery**, select **Resend**, enter a sender on the verified
   domain, and paste the key into **Resend API key**.
4. Select **Save and continue** in the wizard (**Save changes** in Settings), then
   perform the verification test below.

Use the provider's current [domain instructions](https://resend.com/docs/dashboard/domains/introduction)
and [API-key guide](https://resend.com/docs/dashboard/api-keys/introduction).

## SMTP from another provider

Ask your mail provider for its **outgoing SMTP settings** and confirm it permits
automated login emails. This form supports username/password authentication, not
providers that require SMTP OAuth. Do not assume your everyday inbox password is
the right credential; the provider may issue a dedicated SMTP or app password.

Select **SMTP** in Boopity, then match these fields to the provider's instructions:

| Boopity field       | What to enter                                                     |
| ------------------- | ----------------------------------------------------------------- |
| Sender email        | An address this provider permits you to send from                 |
| SMTP host           | The outgoing mail hostname, without `https://` or a path          |
| Port                | The provider's port number                                        |
| Connection security | Usually STARTTLS on 587, or Direct TLS on 465; match the provider |
| SMTP username       | The provider-issued login, if required                            |
| SMTP password       | Its SMTP/app credential, if required                              |

Select **Save and continue** in the wizard (**Save changes** in Settings).
Public connections must support TLS with a valid
certificate; do not disable certificate checks to bypass a failed connection.
The [SMTP transport documentation](https://nodemailer.com/smtp) explains the
underlying port/security distinction.

## Test delivery and verify your owner account

1. Saving settings alone sends **nothing**. Open **Verify your inbox**.
2. Check the selected owner address and choose **Send sign-in code**.
3. Check that inbox and spam folder. Provider acceptance does not guarantee
   delivery to your inbox.
4. Enter the six-digit code and choose **Verify inbox & create owner**. A code
   expires after five minutes. Only the newest code works; never share it.
5. Finish the remaining wizard steps. The review must show a verified owner
   inbox and configured email. You can skip Google.

Changing sender/provider credentials requires another delivery and verification
before finishing setup. Saved settings survive leaving the wizard; unsaved form
edits do not. New setup browser sessions last seven days. After expiry, enter your
setup password and select **Continue setup**. Once email works, you can also use
an email code. After the owner is established, the setup password stops working;
use normal owner sign-in.

## Troubleshooting

| What you see                   | What to check                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings saved, but no email   | Send the code explicitly in **Verify your inbox**                                                                                                                      |
| Provider rejects sending       | Authorized sender/domain, credential permissions, account limits and recipient restrictions                                                                            |
| SMTP connection fails          | Exact host, port and matching security; ask your web host whether outbound SMTP on that port is allowed                                                                |
| Provider accepted, but no code | Owner address, spam folder and the provider's delivery/bounce log; wait a minute before resending                                                                      |
| Code invalid or expired        | Use the newest code within five minutes; request a fresh one if needed                                                                                                 |
| Settings managed by host       | Existing environment configuration takes precedence. Update it on the host, or have the installer remove the email overrides so you can configure the whole group here |
| Saved secret field looks blank | This is intentional. The saved indicator confirms a credential exists; leaving it blank keeps that value                                                               |

Keep setup links, codes and credentials out of screenshots, public Issues, chats
and support tickets. If credentials were exposed, replace them with your provider
and update the installation. If an existing owner cannot sign in because email
is broken, use the [recovery instructions](SELF-HOSTING.md), not a new owner claim.

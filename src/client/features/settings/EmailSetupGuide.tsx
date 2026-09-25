/** Provider accounts belong to the sitter; this guide never creates one or sends mail. */
export function EmailSetupGuide({
  verificationLabel = "Verify your inbox",
}: {
  verificationLabel?: string;
}) {
  return (
    <div className="space-y-4 text-sm leading-6 text-muted-foreground">
      <p>
        Boopity emails sign-in codes to you and your clients. Connect an email
        service below so everyone can receive their code and log in.
      </p>
      <div className="space-y-3">
        <details>
          <summary className="cursor-pointer font-medium text-foreground">
            Using Resend
          </summary>
          <div className="mt-2 space-y-2">
            <p>You’ll need a domain you own, such as yourbusiness.com.</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Add your domain in Resend and follow its verification steps.
                Keep existing email DNS records.
              </li>
              <li>Create a sending-only API key for that domain.</li>
              <li>
                Choose Resend below. Enter a sender address on your verified
                domain and paste the key.
              </li>
            </ol>
            <p>
              Resend guides:{" "}
              <a
                className="underline"
                href="https://resend.com/docs/dashboard/domains/introduction"
                target="_blank"
                rel="noopener noreferrer"
              >
                Domain setup
              </a>
              {" · "}
              <a
                className="underline"
                href="https://resend.com/docs/dashboard/api-keys/introduction"
                target="_blank"
                rel="noopener noreferrer"
              >
                Create an API key
              </a>
            </p>
          </div>
        </details>
        <details>
          <summary className="cursor-pointer font-medium text-foreground">
            Using another provider (SMTP)
          </summary>
          <div className="mt-2 space-y-2">
            <p>
              Ask your email provider for its outgoing mail (SMTP) settings.
            </p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Choose SMTP below and enter a sender address your provider has
                approved.
              </li>
              <li>Copy the host, port and connection security settings.</li>
              <li>
                Enter the SMTP username and password your provider supplies. You
                may need an app password.
              </li>
            </ol>
            <p>
              Check that your provider allows sign-in emails and supports a
              secure SMTP connection with a password.
            </p>
          </div>
        </details>
        <details>
          <summary className="cursor-pointer font-medium text-foreground">
            Code not arriving?
          </summary>
          <div className="mt-2 space-y-2">
            <p>
              After saving, use {verificationLabel} to send a code and check it
              arrives.
            </p>
            <p>
              Check your spam folder and account email address. Wait a minute
              before requesting another code. Use the newest code within five
              minutes.
            </p>
            <p>
              Still no email? Check your email provider’s delivery log for
              errors.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}

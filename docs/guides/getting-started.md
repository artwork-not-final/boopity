# Set up Boopity

## Start setup

1. Start Boopity using the [installation instructions](self-hosting.md).
   If your browser does not open, use the private **Finish setup** link in the terminal.
   If someone installed Boopity for you, use the private setup link they provide.
2. Select **Start setup**. You do not need to choose a setup password.
3. Add your name and email, connect email delivery, and customize your business.
4. Verify your inbox to establish the owner, then review and finish setup.

The database is created automatically; there is no connection string to enter.
You do not need email working to open the wizard. Follow the
[email setup guide](email-setup.md) when you reach Email delivery. Google sign-in
and online payments can be configured later.

Use **Save and continue** to save each step and move on. Saving email settings
does not send a message; you choose when to send a verification code.
If a code button shows a countdown, wait for it to finish before trying again.
You can still enter a code you already received while waiting to resend.
Boopity will not send another code automatically.

Boopity works with your own hosting. Once the app is installed, the wizard takes
you through your business settings; it does not create or manage your hosting account.
Need to install it first? Follow the [installation guide](self-hosting.md#use-your-own-hosting-provider).

## Come back later

Open your website in the same browser to continue where you left off. Your setup
session lasts seven days. If it expires or you switch browsers, you can sign in
with a code sent to the email saved during setup once email delivery is connected.

If email is not connected yet, follow the
[reopen setup instructions](../development/installer-access.md#open-setup-from-the-installer)
for a fresh private link, or ask whoever installed Boopity for one. The new link replaces earlier
setup links and sessions, but keeps your saved details. It works once and expires
after 30 minutes; keep it private.

Saved details stay on your server. Unsaved edits are not retained.

## If your installer supplied a setup password

Some hosts use a private setup password instead of a link. Enter it on your
website to start or resume setup. You will not be asked to choose another one.

If email recovery is ready, select **Email me a sign-in code**. Enter the email
address saved during setup, select **Send sign-in code**, then check your inbox.
Verifying the code lets you continue setup without your password. No email is
sent until you request it. If you cannot receive a code, select **Can’t receive a code?**

Before email recovery is ready, select **Help me find my setup password**.
The guide helps you check your saved passwords or find the password from whoever
installed Boopity. If you still cannot find it, select **I still can’t find it**
for step-by-step instructions to change it through your hosting account.
This last-resort reset keeps your saved details; do not delete the app or its storage.
For local installations or further help, your installer can follow the
[access and recovery instructions](../development/installer-access.md).

## After owner verification

Use normal email-code or Google sign-in from then on. Initial setup links and
passwords cannot reopen ownership. Settings stay separate from setup. If your
installer supplied a setup password, ask them to remove it from the hosting settings.

## Change your account email

Open **Settings → Your account**, enter your new email, and select **Send
verification codes**. Enter the separate codes from your current and new inboxes,
then confirm. Both codes expire after five minutes; resending replaces both.
Your current email stays active until the change succeeds.

You will be signed out on all devices. Sign back in with a code sent to your new
email, or with Google using that same address. The old Google connection is removed;
your clients, pets, bookings and payments stay with your account. **Email delivery**
settings control outgoing messages, not your sign-in address.

If you cannot access your current inbox, ask your installer to use
[account recovery](../development/installer-access.md) instead. Do not delete the
installation or create a replacement owner.

## Installing on your own computer?

Follow [the local installation instructions](self-hosting.md#start-locally).
The initial private link opens the wizard without a password. Installer links,
legacy codes and managed-email installations
are covered in the [installer guide](../development/installer-access.md), not the normal setup screen.

## Before clients book

Add your services, clients and their pets. In **Portal & rules**, set your booking
hours and save. Clients won’t see available times until you do this. Offer the
services you want clients to book in the portal, then invite them to sign in.

When you add a booking, the same hours and minimum notice apply. For a one-off
exception, select **Book outside opening hours** or **Waive minimum booking notice**.
These options do not change your usual hours or let you double-book or use an
unavailable date. To record work already done, choose a past date and time; it
will be saved as completed, with payment tracked separately.

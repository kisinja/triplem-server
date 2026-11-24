const { Resend } = require("resend");

let resendClient;

function getResendClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }

  return resendClient;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[char];
  });
}

const INBOXES = {
  support: process.env.SUPPORT_EMAIL || "support@watchtriplem.co.ke",
  billing: process.env.BILLING_EMAIL || "billing@watchtriplem.co.ke",
  info: process.env.INFO_EMAIL || "info@watchtriplem.co.ke",
};
const DEFAULT_FROM = process.env.EMAIL_FROM || `Triple M <${INBOXES.support}>`;

/**
 * Centralized Triple M email sender.
 */
async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo = INBOXES.support,
  from = DEFAULT_FROM,
}) {
  if (!to || !subject || (!html && !text)) {
    throw new Error("Recipient, subject and email content are required");
  }

  const { data, error } = await getResendClient().emails.send({
    from,
    to,
    subject,
    html,
    text,
    ...(replyTo ? { replyTo } : {}),
  });

  if (error) {
    console.error("Resend delivery error:", error);
    throw new Error(`Email delivery failed: ${error.message}`);
  }

  console.log("Triple M email accepted:", data.id);

  return {
    success: true,
    messageId: data.id,
  };
}

/**
 * Password reset email.
 * Existing auth.controller.js remains compatible.
 */
async function sendPasswordResetEmail({ to, resetUrl }) {
  const safeUrl = escapeHtml(resetUrl);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your password</title>
</head>

<body style="margin:0;padding:0;background:#150f19;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"
    style="background:#150f19;padding:40px 16px;">
    <tr>
      <td align="center">

        <table width="100%"
          style="max-width:520px;background:#221828;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">

          <tr>
            <td style="padding:32px 28px 16px;text-align:center;">
              <h1 style="margin:0;font-size:24px;line-height:1.3;color:#ffffff;">
                Reset your password
              </h1>

              <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#a1a1aa;">
                We received a request to reset the password for your Triple M account.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 28px 24px;text-align:center;">
              <a href="${safeUrl}"
                style="display:inline-block;background:#eab54d;color:#241800;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:12px;">
                Reset Password
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding:0 28px 24px;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:#a1a1aa;text-align:center;">
                This link expires in
                <strong style="color:#e4e4e7;">15 minutes</strong>.
                If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 28px 28px;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#71717a;text-align:center;word-break:break-all;">
                Or copy and paste this link into your browser:
                <br />
                <a href="${safeUrl}" style="color:#eab54d;text-decoration:none;">
                  ${safeUrl}
                </a>
              </p>
            </td>
          </tr>

        </table>

        <p style="margin:24px 0 0;font-size:12px;color:#52525b;">
          &copy; ${new Date().getFullYear()} Triple M
        </p>

      </td>
    </tr>
  </table>
</body>
</html>
`;

  const text = `
Reset your Triple M password

We received a request to reset your password.

Reset your password here:
${resetUrl}

This link expires in 15 minutes.

If you didn't request this, you can safely ignore this email.

Triple M
`;

  return sendEmail({
    to,
    subject: "Reset your Triple M password",
    html,
    text,
    replyTo: INBOXES.support,
  });
}

const TOPIC_LABELS = {
  support: "Support",
  billing: "Billing",
  info: "General",
};
const oneLine = (v) =>
  String(v)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[<>"]/g, "")
    .trim();

async function sendContactMessageEmail({
  name,
  email,
  topic,
  subject,
  message,
}) {
  const inbox = INBOXES[topic] ? topic : "support";
  const label = TOPIC_LABELS[inbox];
  const cleanName = oneLine(name);
  const cleanSubject = oneLine(subject || "") || "New message";

  const html = `
<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111;">
  <p><strong>Topic:</strong> ${escapeHtml(label)}<br>
  <strong>From:</strong> ${escapeHtml(cleanName)} &lt;${escapeHtml(email)}&gt;<br>
  <strong>Subject:</strong> ${escapeHtml(cleanSubject)}</p>
  <div style="white-space:pre-wrap;border-left:3px solid #eab54d;padding-left:12px;">${escapeHtml(message)}</div>
  <p style="font-size:12px;color:#666;">Sent from the Triple M contact form. Reply to answer the sender.</p>
</div>`;
  const text = `Topic: ${label}\nFrom: ${cleanName} <${email}>\nSubject: ${cleanSubject}\n\n${message}`;

  return sendEmail({
    to: INBOXES[inbox],
    subject: `[${label}] ${cleanSubject}`,
    html,
    text,
    from: `Triple M Contact Form <${INBOXES.support}>`,
    replyTo: `${cleanName} <${email}>`, // hitting Reply answers the visitor
  });
}

/**
 * Welcome email after successful registration
 */
async function sendWelcomeEmail({ to, name }) {
  const displayName = escapeHtml(name || "there");
  const siteUrl = process.env.FRONTEND_URL || "https://watchtriplem.co.ke";
  const supportEmail = INBOXES.support;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Triple M</title>
</head>
<body style="margin:0;padding:0;background:#0f0b13;font-family:Arial,Helvetica,sans-serif;color:#f4edf6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0b13;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#1a1322;border-radius:18px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:28px 28px 18px;border-bottom:1px solid rgba(255,255,255,0.06);">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left" style="font-size:20px;font-weight:700;letter-spacing:0.3px;color:#ffffff;">
                    Triple M
                  </td>
                  <td align="right" style="font-size:12px;color:#a1a1aa;">
                    Welcome email
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td style="padding:36px 28px 8px;text-align:left;">
              <p style="margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#eab54d;">
                You're in
              </p>
              <h1 style="margin:0;font-size:28px;line-height:1.25;color:#ffffff;">
                Welcome to Triple M, ${displayName}
              </h1>
              <p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:#c4c0c8;">
                Your account is ready. Browse movies and shows, save titles to My List, and subscribe when you want full streaming access.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:22px 28px 8px;">
              <a href="${escapeHtml(siteUrl)}"
                 style="display:inline-block;background:#eab54d;color:#241800;text-decoration:none;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;">
                Start watching
              </a>
            </td>
          </tr>

          <!-- Features -->
          <tr>
            <td style="padding:24px 28px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#150f19;border:1px solid rgba(255,255,255,0.06);border-radius:14px;">
                <tr>
                  <td style="padding:18px 18px 6px;font-size:14px;line-height:1.6;color:#ddd6e2;">
                    <strong style="color:#ffffff;">What you can do now</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 18px 16px;font-size:14px;line-height:1.7;color:#b7b0bd;">
                    • Explore trending movies and series<br/>
                    • Save favorites to My List<br/>
                    • Subscribe anytime to unlock full playback
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Secondary text -->
          <tr>
            <td style="padding:18px 28px 30px;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:#8b8491;">
                Need help getting started? Reply to this email or contact
                <a href="mailto:${escapeHtml(supportEmail)}" style="color:#eab54d;text-decoration:none;">
                  ${escapeHtml(supportEmail)}
                </a>.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 28px;background:#140f18;border-top:1px solid rgba(255,255,255,0.06);">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#6f6875;">
                © ${new Date().getFullYear()} Triple M ·
                <a href="${escapeHtml(siteUrl)}" style="color:#9a93a0;text-decoration:none;">watchtriplem.co.ke</a>
              </p>
              <p style="margin:8px 0 0;font-size:11px;line-height:1.5;color:#5c5560;">
                You received this email because an account was created with this address.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  const text = `
Welcome to Triple M, ${name || "there"}

Your account is ready.

Browse movies and shows, save titles to My List, and subscribe when you want full streaming access.

Start watching: ${siteUrl}

Need help? ${supportEmail}

© ${new Date().getFullYear()} Triple M
`;

  return sendEmail({
    to,
    subject: "Welcome to Triple M",
    html,
    text,
    replyTo: INBOXES.support,
  });
}

/**
 * Subscription reminder (before expiry)
 * daysLeft: number of days remaining
 */
async function sendSubscriptionReminderEmail({
  to,
  name,
  expiresAt,
  daysLeft,
  planLabel,
}) {
  const displayName = escapeHtml(name || "there");
  const siteUrl = process.env.FRONTEND_URL || "https://watchtriplem.co.ke";
  const profileUrl = `${siteUrl}/profile`;
  const expiryText = expiresAt
    ? new Date(expiresAt).toLocaleString("en-KE", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "soon";

  const urgency =
    daysLeft <= 1
      ? "Your subscription ends tomorrow."
      : `Your subscription ends in ${daysLeft} days.`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Subscription reminder</title>
</head>
<body style="margin:0;padding:0;background:#150f19;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#150f19;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#221828;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
          <tr>
            <td style="padding:32px 28px 12px;text-align:center;">
              <h1 style="margin:0;font-size:22px;line-height:1.3;color:#ffffff;">
                Subscription reminder
              </h1>
              <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#a1a1aa;">
                Hi ${displayName}, ${escapeHtml(urgency)}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 20px;text-align:center;">
              <p style="margin:0;font-size:14px;line-height:1.6;color:#d4d4d8;">
                ${planLabel ? `Plan: <strong style="color:#e4e4e7;">${escapeHtml(planLabel)}</strong><br/>` : ""}
                Expires: <strong style="color:#e4e4e7;">${escapeHtml(expiryText)}</strong>
              </p>
              <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#a1a1aa;">
                Renew now to keep streaming without interruption.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;text-align:center;">
              <a href="${escapeHtml(profileUrl)}"
                 style="display:inline-block;background:#eab54d;color:#241800;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:12px;">
                Renew subscription
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:24px 0 0;font-size:12px;color:#52525b;">
          &copy; ${new Date().getFullYear()} Triple M
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  const text = `
Subscription reminder

Hi ${name || "there"}, ${urgency}

${planLabel ? `Plan: ${planLabel}\n` : ""}Expires: ${expiryText}

Renew here: ${profileUrl}

Triple M
`;

  return sendEmail({
    to,
    subject:
      daysLeft <= 1
        ? "Your Triple M subscription ends tomorrow"
        : `Your Triple M subscription ends in ${daysLeft} days`,
    html,
    text,
    replyTo: INBOXES.billing,
  });
}

module.exports = {
  INBOXES,
  sendEmail,
  sendPasswordResetEmail,
  sendContactMessageEmail,
  sendWelcomeEmail,
  sendSubscriptionReminderEmail,
};

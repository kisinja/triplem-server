const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Failed to fetch logo: ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

/**
 * Build a professional Triple M payment receipt PDF.
 * Returns a Buffer.
 */
async function buildPaymentReceiptPdf({
  name,
  planLabel,
  amountKes,
  currency = "KES",
  expiresAt,
  paidAt,
  mpesaReceipt,
  reference,
  phone,
}) {
  const logoUrl = process.env.LOGO_URL || "";
  let logoBuffer = null;

  if (logoUrl) {
    try {
      logoBuffer = await fetchBuffer(logoUrl);
    } catch (err) {
      console.warn("Receipt logo fetch failed:", err.message);
    }
  }

  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
  });

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));

  const done = new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const amountText = `${currency} ${Number(amountKes || 0).toFixed(0)}`;
  const paidAtText = paidAt
    ? new Date(paidAt).toLocaleString("en-KE", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : new Date().toLocaleString("en-KE", {
        dateStyle: "medium",
        timeStyle: "short",
      });
  const expiryText = expiresAt
    ? new Date(expiresAt).toLocaleString("en-KE", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
  const receiptNo = mpesaReceipt || reference || `TM-${Date.now()}`;

  // Header / logo
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, 50, 40, { width: 64 });
    } catch {
      // ignore bad image data
    }
  }

  doc
    .fontSize(20)
    .fillColor("#111")
    .text("Triple M", logoBuffer ? 130 : 50, 50);

  doc
    .fontSize(11)
    .fillColor("#666")
    .text("Payment Receipt", logoBuffer ? 130 : 50, 75);

  doc.moveDown(2);

  // Title
  doc.fontSize(18).fillColor("#111").text("Payment confirmed", 50);

  doc
    .fontSize(11)
    .fillColor("#444")
    .text(`Hi ${name || "Customer"}, thank you for your payment.`, {
      width: 500,
    });

  doc.moveDown(1.2);

  // Details box
  const boxTop = doc.y;
  doc.roundedRect(50, boxTop, 495, 120, 8).strokeColor("#ddd").stroke();

  doc
    .fontSize(11)
    .fillColor("#333")
    .text(`Receipt No.: ${receiptNo}`, 65, boxTop + 14)
    .text(`Date paid: ${paidAtText}`, 65, boxTop + 34)
    .text(`Billed to: ${name || "Customer"}`, 65, boxTop + 54)
    .text(`Phone: ${phone || "—"}`, 65, boxTop + 74)
    .text(`Reference: ${reference || "—"}`, 65, boxTop + 94, {
      width: 460,
    });

  doc.y = boxTop + 140;

  // Line items header
  doc
    .fontSize(11)
    .fillColor("#666")
    .text("Description", 50, doc.y)
    .text("Amount", 450, doc.y, { width: 95, align: "right" });

  doc
    .moveTo(50, doc.y + 16)
    .lineTo(545, doc.y + 16)
    .strokeColor("#eee")
    .stroke();

  doc.moveDown(1.2);

  doc
    .fontSize(12)
    .fillColor("#111")
    .text(planLabel || "Subscription", 50, doc.y, { width: 360 });

  doc.fontSize(10).fillColor("#666").text(`Valid until ${expiryText}`, 50);

  const amountY = doc.y - 24;
  doc
    .fontSize(12)
    .fillColor("#111")
    .text(amountText, 450, amountY, { width: 95, align: "right" });

  doc.moveDown(1.5);

  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#ddd").stroke();

  doc.moveDown(0.8);

  doc
    .fontSize(13)
    .fillColor("#111")
    .text("Total paid", 50, doc.y)
    .text(amountText, 450, doc.y, { width: 95, align: "right" });

  doc.moveDown(2);

  doc
    .fontSize(10)
    .fillColor("#666")
    .text(
      "This is an automated receipt for your records. For help, contact billing@watchtriplem.co.ke",
      {
        width: 495,
      },
    );

  doc.moveDown(1.5);

  doc.fontSize(9).fillColor("#999").text("© Triple M · watchtriplem.co.ke", 50);

  doc.end();
  return done;
}

module.exports = { buildPaymentReceiptPdf };

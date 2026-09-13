import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Server-side entry pass: same QR payload the gate scanner reads
// (raw invitations.qrToken, see QrCard + getInvitationByQrToken).
export async function buildInvitationPdf(input: {
  code: string;
  studentName: string;
  guestLimit: number;
  qrToken: string;
}): Promise<Buffer> {
  const qrDataUrl = await QRCode.toDataURL(input.qrToken, {
    width: 480,
    margin: 2,
    errorCorrectionLevel: "M",
  });
  const qrBytes = Buffer.from(qrDataUrl.split(",")[1], "base64");

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([420, 600]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const qr = await pdf.embedPng(qrBytes);

  const ink = rgb(0.11, 0.07, 0.15);
  page.drawText("Annual Function 2026", { x: 40, y: 548, size: 22, font: bold, color: ink });
  page.drawText("Entry pass", { x: 40, y: 524, size: 13, font, color: ink });
  page.drawText(input.studentName, { x: 40, y: 492, size: 17, font: bold, color: ink });
  page.drawText(`Invitation code: ${input.code}`, { x: 40, y: 468, size: 12, font, color: ink });
  page.drawText(`Guests allowed: ${input.guestLimit}`, { x: 40, y: 450, size: 12, font, color: ink });
  page.drawRectangle({ x: 40, y: 180, width: 240, height: 240, borderColor: ink, borderWidth: 2 });
  page.drawImage(qr, { x: 48, y: 188, width: 224, height: 224 });
  page.drawText("Show this QR at the entry gate.", { x: 40, y: 150, size: 11, font, color: ink });

  return Buffer.from(await pdf.save());
}

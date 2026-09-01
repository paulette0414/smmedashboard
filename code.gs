/*
 * ─────────────────────────────────────────────────────────────────────────
 * JSON API ROUTER — added so the frontend can be hosted anywhere (GitHub
 * Pages, Netlify, Firebase Hosting, etc.) and talk to this script over
 * fetch() instead of relying on Apps Script's HTML Service + google.script.run
 * (which only works when Apps Script itself is serving the HTML page).
 *
 * DEPLOY THIS AS: Deploy > New deployment > Web app
 *   Execute as:      Me
 *   Who has access:  Anyone
 * Then copy the /exec URL into API_URL at the top of frontend/index.html.
 *
 * IMPORTANT: every time you edit this file, you must create a NEW VERSION
 * of the deployment (Deploy > Manage deployments > pencil icon > New
 * version) — just saving the file does NOT update the live /exec URL.
 * ─────────────────────────────────────────────────────────────────────────
 */

// ── FIX (2026-09): the live frontend (index.html) calls this backend with
// POST body { fn: "functionName", args: [...] } and expects the response
// shaped { result: ... } or { error: "..." } — see callAppsScript() in
// index.html. The original doGet/doPost above used a different shape
// ({action, data} / {action: "x", ...fields}, and raw un-wrapped results),
// which is exactly why every submission silently failed with "Unknown or
// unauthorized function" style errors no matter what else was fixed. This
// version keeps 100% of the underlying logic (Sheets, Drive, MailApp email)
// untouched — only the request/response shape changed, to actually match
// what the deployed frontend sends.
//
// POST body: { "fn": "saveSchool", "args": [ {...} ] }
// Response:  { "result": ... }  or  { "error": "message" }
//
// NOTE: the frontend sends the body with Content-Type: text/plain on
// purpose. Apps Script web apps cannot answer CORS "preflight" (OPTIONS)
// requests, so using text/plain keeps the request a "simple request" that
// skips preflight entirely. We just JSON.parse the text ourselves below.
const API_WHITELIST = {
  // ── Public / applicant-facing (unchanged from the original file) ─────────
  getSettingsData: getSettingsData,
  getAllSubmissions: getAllSubmissions,
  getDashboardStats: getDashboardStats,
  getDashboardImages: getDashboardImages,
  getApplicationRequirements: getApplicationRequirements,
  reserveApplicationCode: reserveApplicationCode,
  searchSchoolById: searchSchoolById,
  saveSchool: saveSchool,
  uploadFileToDrive: uploadFileToDrive,
  // ── Accounts / login (new) ────────────────────────────────────────────────
  registerAccount: registerAccount,
  loginAccount: loginAccount,
  logoutAccount: logoutAccount,
  getMySession: getMySession,
  getMySubmissions: getMySubmissions,
  changePassword: changePassword,
  // ── Admin-only (new; each checks the session role itself) ─────────────────
  listUsers: listUsers,
  setUserStatus: setUserStatus,
  createAdminAccount: createAdminAccount,
  // ── Evaluator/Admin-only (new; checks the session role itself) ────────────
  evaluateApplication: evaluateApplication
  // NOTE: updateStatus() is intentionally NOT exposed directly — it has no
  // permission check of its own. evaluateApplication() wraps it with a
  // role check instead. Call updateStatus() directly only from the Apps
  // Script editor if you ever need to.
};

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const fn = body.fn;
    const args = Array.isArray(body.args) ? body.args : [];
    const impl = API_WHITELIST[fn];

    if (!impl) {
      return jsonOutput({ error: "Unknown or unauthorized function: " + (fn || "") });
    }

    const result = impl.apply(null, args);
    return jsonOutput({ result: result });
  } catch (err) {
    return jsonOutput({ error: err.message });
  }
}

// GET is not used by the current frontend (it POSTs everything through
// doPost above), but is kept as a friendly response for anyone opening the
// /exec URL directly in a browser, e.g. while testing the deployment.
function doGet(e) {
  return jsonOutput({
    status: "ok",
    message: "This endpoint expects POST requests with a JSON body: { fn, args }."
  });
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Reads a column list from a Settings sheet
function getList(sheet, col) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, col, lastRow - 1, 1).getValues()
    .map(r => (r[0] !== null && r[0] !== undefined) ? r[0].toString().trim() : "")
    .filter(v => v !== "");
}

function getSettingsData() {
  const ss = SpreadsheetApp.openById("1Yc-DDDU8muIS5HR0OWoLclUnK6RGPrcVe_ydYlgWOYI");
  const sh = ss.getSheetByName("Settings");
  if (!sh) throw new Error("Settings sheet not found.");
  return {
    district:        getList(sh, 1),
    sector:          getList(sh, 2),
    applicationType: getList(sh, 3)
  };
}

// ── generateApplicationCode ────────────────────────────────────────────────────
// Format: APP-YYYY-NNN  (e.g. APP-2026-001)
// Resets to 001 whenever the year changes. Uses LockService to prevent
// duplicate codes if two people submit at the exact same time.
function generateApplicationCode() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000); // wait up to 30s for other submissions to finish

  try {
    const ss    = SpreadsheetApp.openById("1Yc-DDDU8muIS5HR0OWoLclUnK6RGPrcVe_ydYlgWOYI");
    const sheet = ss.getSheetByName("SchoolData");
    const lastRow = sheet.getLastRow();

    const currentYear = new Date().getFullYear();
    let maxSeq = 0;

    if (lastRow > 1) {
      // Column O (15) holds the Application Code
      const codes = sheet.getRange(2, 15, lastRow - 1, 1).getValues().flat();
      codes.forEach(function (c) {
        if (!c) return;
        const match = c.toString().trim().match(/^APP-(\d{4})-(\d+)$/);
        if (match && parseInt(match[1], 10) === currentYear) {
          const seq = parseInt(match[2], 10);
          if (seq > maxSeq) maxSeq = seq;
        }
      });
    }

    const nextSeq = maxSeq + 1;
    const paddedSeq = nextSeq.toString().padStart(3, "0");
    return "APP-" + currentYear + "-" + paddedSeq;

  } finally {
    lock.releaseLock();
  }
}

// ── saveSchool ────────────────────────────────────────────────────────────────
// Sheet column layout:
//  A(1)  School ID
//  B(2)  School Name
//  C(3)  School Address
//  D(4)  Courses Offered
//  E(5)  School Year
//  F(6)  School Admin
//  G(7)  Contact Number
//  H(8)  District
//  I(9)  Sector
//  J(10) Application Type
//  K(11) Document Link   ← passed from client after uploadFileToDrive
//  L(12) Email Address
//  M(13) Date Submitted
//  N(14) Status          ← defaults to "Pending" on first insert, never overwritten on update
//  O(15) Application Code ← auto-generated (APP-YYYY-NNN) on first insert only, never overwritten on update
//  P(16) MOV Attachments ← human-readable text with clickable Drive links,
//                          one block per Required-Document row the applicant
//                          attached a MOV to (formatted server-side by
//                          formatMovAttachments_ from the JSON the client sends)
// ── formatMovAttachments_ ──────────────────────────────────────────────────────
// Converts the JSON string sent by the client (array of
// {criteria, requirement, fileUrl, fileName}) into a human-readable, multi-line
// block of text so it's actually visible/clickable when opened in Google Sheets
// (Sheets auto-links plain https:// URLs found in cell text, even in
// multi-line cells — a raw JSON blob would not be readable at a glance).
function formatMovAttachments_(rawJson) {
  const jsonStr = (rawJson || "").toString().trim();
  if (!jsonStr) return "";

  let list;
  try {
    list = JSON.parse(jsonStr);
  } catch (e) {
    return jsonStr; // fall back to whatever was sent, rather than losing data
  }
  if (!Array.isArray(list) || list.length === 0) return "";

  return list.map(function (item, idx) {
    const criteria = (item && item.criteria) ? item.criteria.toString().replace(/\s+/g, " ").trim() : "(no criteria label)";
    const fileName = (item && item.fileName) || "";
    const fileUrl  = (item && item.fileUrl) || "";
    return (idx + 1) + ". " + criteria + "\n   File: " + fileName + "\n   Link: " + fileUrl;
  }).join("\n\n");
}

function saveSchool(data) {
  const ss    = SpreadsheetApp.openById("1Yc-DDDU8muIS5HR0OWoLclUnK6RGPrcVe_ydYlgWOYI");
  const sheet = ss.getSheetByName("SchoolData");
  if (!sheet) throw new Error("SchoolData sheet not found.");

  const lastRow = sheet.getLastRow();
  let values = [];
  if (lastRow > 1) {
    values = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  }

  const rowIndex = values.findIndex(v => v.toString().trim() === data.schoolId.toString().trim());

  const dateSubmitted = data.dateSubmitted ||
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

  const emailAddr    = (data.emailAddress  || "").toString().trim();
  const documentLink = (data.documentLink  || "").toString().trim();
  const movAttachments = formatMovAttachments_(data.movAttachments);

  if (rowIndex !== -1) {
    // ── UPDATE existing row ──────────────────────────────────────────────────
    // Cols B–J (2–10): school info fields
    sheet.getRange(rowIndex + 2, 2, 1, 9).setValues([[
      data.schoolName,
      data.schoolAddress,
      data.coursesOffered,
      data.schoolYear,
      data.schoolAdmin,
      data.contactNumber,
      data.district,
      data.sector,
      data.applicationType
    ]]);
    // Update Document Link (col K) only if a new one was provided
    if (documentLink) {
      sheet.getRange(rowIndex + 2, 11).setValue(documentLink);
    }
    sheet.getRange(rowIndex + 2, 12).setValue(emailAddr);
    sheet.getRange(rowIndex + 2, 13).setValue(dateSubmitted);
    // Col N (14): Status — intentionally skipped on update
    // Col O (15): Application Code — intentionally skipped on update
    // Update MOV Attachments (col P) only if new attachments were provided
    if (movAttachments) {
      const movCell = sheet.getRange(rowIndex + 2, 16);
      movCell.setValue(movAttachments);
      movCell.setWrap(true); // so the multi-line, clickable-link text is visible in the cell
    }
    return "School record updated successfully.";

  } else {
    // ── INSERT new row ───────────────────────────────────────────────────────
    const applicationCode = (data.applicationCode || "").toString().trim() || generateApplicationCode();

    sheet.appendRow([
      data.schoolId,        // A  col 1
      data.schoolName,      // B  col 2
      data.schoolAddress,   // C  col 3
      data.coursesOffered,  // D  col 4
      data.schoolYear,      // E  col 5
      data.schoolAdmin,     // F  col 6
      data.contactNumber,   // G  col 7
      data.district,        // H  col 8
      data.sector,          // I  col 9
      data.applicationType, // J  col 10
      documentLink,         // K  col 11 — Document Link (from client)
      emailAddr,            // L  col 12
      dateSubmitted,        // M  col 13
      "Pending",            // N  col 14 — Status
      applicationCode,      // O  col 15 — Application Code (APP-YYYY-NNN)
      movAttachments        // P  col 16 — MOV Attachments (readable text with clickable Drive links)
    ]);
    sheet.getRange(sheet.getLastRow(), 16).setWrap(true); // so multi-line MOV links are visible in the cell

    // ── Send acknowledgment email for NEW submissions only ───────────────────
    if (emailAddr) {
      try {
        sendAcknowledgmentEmail(emailAddr, data.schoolName, data.schoolId, applicationCode);
        return "New application submitted successfully. Application Code: " + applicationCode +
          ". Acknowledgment email sent to " + emailAddr + ".";
      } catch (emailErr) {
        return "New application submitted successfully. Application Code: " + applicationCode +
          ". NOTE: Email could not be sent — " + emailErr.message;
      }
    }
    return "New application submitted successfully. Application Code: " + applicationCode +
      ". (No email address provided — acknowledgment not sent.)";
  }
}

// ── sendAcknowledgmentEmail ───────────────────────────────────────────────────
function sendAcknowledgmentEmail(emailAddress, schoolName, schoolId, applicationCode) {
  const recipient = (emailAddress || "").toString().trim();
  if (!recipient) {
    throw new Error("No recipient email address was provided for the acknowledgment email.");
  }

  const subject = "Application Acknowledgment - SMME Section, SGOD-SDO ROMBLON";

  const body =
    "Dear Applicant,\n\n" +
    "Greetings!\n\n" +
    "Thank you for submitting your application to the SMME Section.\n\n" +
    "This is to acknowledge that we have successfully received your application and " +
    "supporting documents for " + schoolName + " (School ID: " + schoolId + "). " +
    "Your Application Code is: " + applicationCode + ". Please keep this code for tracking " +
    "your application status.\n\n" +
    "Your application is now undergoing the initial review and verification process.\n\n" +
    "We kindly ask for your patience while we evaluate your submission. You will be " +
    "notified through this email address regarding the status of your application or " +
    "if additional information or documents are required.\n\n" +
    "Please refrain from submitting duplicate applications, as this may cause delays " +
    "in processing.\n\n" +
    "Thank you for your interest and cooperation. We appreciate your patience and " +
    "understanding.\n\n" +
    "Sincerely,\n" +
    "SMME Section\n" +
    "Schools Division Office\n" +
    "Division of Romblon";

  const htmlBody =
    "<p>Dear Applicant,</p>" +
    "<p>Greetings!</p>" +
    "<p>Thank you for submitting your application to the SMME Section.</p>" +
    "<p>This is to acknowledge that we have successfully received your application and " +
    "supporting documents for <strong>" + schoolName + "</strong> " +
    "(School ID: <strong>" + schoolId + "</strong>). " +
    "Your Application Code is: <strong>" + applicationCode + "</strong>. Please keep this code " +
    "for tracking your application status.</p>" +
    "<p>Your application is now undergoing the initial review and verification process.</p>" +
    "<p>We kindly ask for your patience while we evaluate your submission. You will be " +
    "notified through this email address regarding the status of your application or " +
    "if additional information or documents are required.</p>" +
    "<p>Please refrain from submitting duplicate applications, as this may cause delays " +
    "in processing.</p>" +
    "<p>Thank you for your interest and cooperation. We appreciate your patience and " +
    "understanding.</p><br>" +
    "<p>Sincerely,<br><strong>SMME Section</strong><br>" +
    "Schools Division Office<br>Division of Romblon</p>";

  MailApp.sendEmail({
    to:       recipient,
    subject:  subject,
    body:     body,
    htmlBody: htmlBody,
    replyTo:  "romblon.sgod.smmes@deped.gov.ph",
    name:     "SMME Section - SGOD DepEd Division of Romblon"
  });
}

// ── reserveApplicationCode ────────────────────────────────────────────────────
// Returns the Application Code to use for this School ID, so that MOV files
// uploaded *before* the final Submit (per criteria-row attachments) can be
// saved into a Drive subfolder named after the same code the sheet will
// eventually record.
//   • If this School ID already has a row in the sheet, its existing
//     Application Code is reused (keeps everything consistent on edits).
//   • Otherwise, a new code is generated and reserved. Note: if the applicant
//     abandons the form without submitting, that code number is simply skipped
//     — it is not written to the sheet until saveSchool() actually runs.
function reserveApplicationCode(schoolId) {
  const ss    = SpreadsheetApp.openById("1Yc-DDDU8muIS5HR0OWoLclUnK6RGPrcVe_ydYlgWOYI");
  const sheet = ss.getSheetByName("SchoolData");
  if (!sheet) throw new Error("SchoolData sheet not found.");

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const idCol   = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const rowIdx  = idCol.findIndex(function (v) { return v.toString().trim() === schoolId.toString().trim(); });
    if (rowIdx !== -1) {
      const existingCode = sheet.getRange(rowIdx + 2, 15).getValue();
      if (existingCode) return existingCode.toString().trim();
    }
  }
  return generateApplicationCode();
}

// ── getOrCreateSubfolder_ ──────────────────────────────────────────────────────
// Returns the subfolder with the given name inside parentFolder, creating it
// if it doesn't already exist (so repeated MOV uploads for the same
// application reuse the same folder instead of making duplicates).
function getOrCreateSubfolder_(parentFolder, folderName) {
  const safeName = (folderName || "unspecified").toString().trim();
  const existing = parentFolder.getFoldersByName(safeName);
  if (existing.hasNext()) return existing.next();
  return parentFolder.createFolder(safeName);
}

// ── uploadFileToDrive ─────────────────────────────────────────────────────────
// Uploads the file into a subfolder (named after the Application Code) inside
// the shared uploads folder, and returns the fileUrl to the client.
function uploadFileToDrive(fileName, base64Data, schoolId, applicationCode) {
  try {
    const rootFolderId = "1H5F4nWAFYPTSUPPYRDxIHSXHO88Ac4SS";
    const rootFolder    = DriveApp.getFolderById(rootFolderId);
    const folder        = getOrCreateSubfolder_(rootFolder, applicationCode || schoolId);

    const ext     = fileName.split(".").pop().toLowerCase();
    const mimeMap = {
      pdf:  "application/pdf",
      doc:  "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      jpg:  "image/jpeg",
      jpeg: "image/jpeg",
      png:  "image/png"
    };
    const mimeType = mimeMap[ext] || "application/octet-stream";

    const decodedBytes = Utilities.base64Decode(base64Data);
    const blob         = Utilities.newBlob(decodedBytes, mimeType, fileName);
    const file         = folder.createFile(blob);
    const fileUrl      = file.getUrl();
    const fileId       = file.getId();

    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      // Non-fatal — file is still uploaded and linked
    }

    return {
      success:    true,
      fileId:     fileId,
      fileUrl:    fileUrl,
      fileName:   file.getName(),
      previewUrl: "https://drive.google.com/file/d/" + fileId + "/preview",
      message:    "File uploaded successfully: " + file.getName()
    };
  } catch (err) {
    return {
      success: false,
      message: "Error uploading file: " + err.message
    };
  }
}

// ── searchSchoolById ──────────────────────────────────────────────────────────
function searchSchoolById(schoolId) {
  const ss    = SpreadsheetApp.openById("1Yc-DDDU8muIS5HR0OWoLclUnK6RGPrcVe_ydYlgWOYI");
  const sheet = ss.getSheetByName("SchoolData");
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().trim() === schoolId.toString().trim()) {
      const documentLink = data[i][10];
      return {
        found:           true,
        schoolId:        data[i][0],
        schoolName:      data[i][1],
        schoolAddress:   data[i][2],
        coursesOffered:  data[i][3],
        schoolYear:      data[i][4],
        schoolAdmin:     data[i][5],
        contactNumber:   data[i][6],
        district:        data[i][7],
        sector:          data[i][8],
        applicationType: data[i][9],
        documentLink:    documentLink,
        previewUrl:      extractPreviewUrl(documentLink),
        emailAddress:    data[i][11],
        dateSubmitted:   data[i][12],
        status:          data[i][13] || "Pending",
        applicationCode: data[i][14] || "",
        movAttachments:  data[i][15] || ""
      };
    }
  }
  return { found: false, message: "School record not found." };
}

function extractPreviewUrl(driveUrl) {
  if (!driveUrl) return "";
  const match = driveUrl.toString().match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return "";
  return "https://drive.google.com/file/d/" + match[1] + "/preview";
}

// ── getDashboardStats ──────────────────────────────────────────────────────────
// Returns submission counts for the Dashboard scorecards.
function getDashboardStats() {
  const ss    = SpreadsheetApp.openById("1Yc-DDDU8muIS5HR0OWoLclUnK6RGPrcVe_ydYlgWOYI");
  const sheet = ss.getSheetByName("SchoolData");
  const lastRow = sheet.getLastRow();

  const stats = { total: 0, pending: 0, approved: 0, rejected: 0 };
  if (lastRow < 2) return stats;

  const idCol     = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const statusCol = sheet.getRange(2, 14, lastRow - 1, 1).getValues().flat();

  for (let i = 0; i < idCol.length; i++) {
    if (idCol[i] === "" || idCol[i] === null || idCol[i] === undefined) continue;
    stats.total++;
    const status = (statusCol[i] || "Pending").toString().trim();
    if (status === "Approved") stats.approved++;
    else if (status === "Rejected") stats.rejected++;
    else stats.pending++;
  }
  return stats;
}

// ── getDashboardImages ─────────────────────────────────────────────────────────
// Returns image URLs from the "Dashboard Carousel Images" Drive folder (auto-
// created on first call if it doesn't exist yet). Admins simply drop images
// into that folder in Drive — no manual folder ID configuration needed.
function getDashboardImages() {
  try {
    const root   = DriveApp.getRootFolder();
    const folder = getOrCreateSubfolder_(root, "Dashboard Carousel Images");

    const images = [];
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const mime = file.getMimeType();
      if (mime.indexOf("image/") !== 0) continue;

      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (shareErr) {
        // Non-fatal — image may already be shared, or sharing is restricted by domain policy
      }

      images.push({
        fileId: file.getId(),
        name:   file.getName(),
        url:    "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w1600"
      });
    }
    return { success: true, images: images, folderUrl: folder.getUrl() };
  } catch (err) {
    return { success: false, message: "Error loading dashboard images: " + err.message, images: [] };
  }
}

// ── getAllSubmissions ─────────────────────────────────────────────────────────
function getAllSubmissions() {
  const ss    = SpreadsheetApp.openById("1Yc-DDDU8muIS5HR0OWoLclUnK6RGPrcVe_ydYlgWOYI");
  const sheet = ss.getSheetByName("SchoolData");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const lastCol = Math.max(sheet.getLastColumn(), 15);
  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const tz = Session.getScriptTimeZone();

  return data
    .filter(row => row[0] !== "" && row[0] !== null && row[0] !== undefined)
    .map(row => {
      let dateStr = "";
      if (row[12] instanceof Date) {
        dateStr = Utilities.formatDate(row[12], tz, "yyyy-MM-dd");
      } else if (row[12]) {
        dateStr = row[12].toString();
      }
      return {
        schoolId:        row[0],
        schoolName:      row[1],
        coursesOffered:  row[3],
        schoolYear:      row[4],
        district:        row[7],
        sector:          row[8],
        applicationType: row[9],
        emailAddress:    row[11] || "", // added for getMySubmissions() filtering — harmless extra field, existing renderRecords() ignores it
        dateSubmitted:   dateStr,
        status:          row[13] || "Pending",
        applicationCode: row[14] || ""
      };
    });
}

// ─────────────────────────────────────────────────────────────────────────
// ACCOUNTS / LOGIN (new) — three roles: Admin (full access), Evaluator
// (reviews/decides on applications), User (submits applications, sees only
// their own). Accounts live in a new "Users" sheet in the same spreadsheet,
// auto-created on first use. Passwords are never stored in plain text —
// each is salted and hashed with SHA-256 (see hashPassword_ below).
//
// Admin accounts are NOT self-registrable — see createInitialAdmin() near
// the bottom of this file for the one-time setup step, and
// createAdminAccount() for how an existing Admin can add more later.
//
// Evaluator self-signups are created with Status "Pending" and cannot log
// in until an Admin approves them (setUserStatus) — Evaluators can decide
// Approved/Rejected on real applications, so this is a safety default, not
// a hard requirement. User self-signups are Active immediately.
// ─────────────────────────────────────────────────────────────────────────

const USERS_SHEET_NAME = "Users";
const SESSION_DURATION_SECONDS = 21600; // 6 hours — CacheService's own maximum

function getUsersSheet_() {
  const ss = SpreadsheetApp.openById("1Yc-DDDU8muIS5HR0OWoLclUnK6RGPrcVe_ydYlgWOYI");
  let sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET_NAME);
    sheet.appendRow(["Username", "PasswordHash", "Role", "FullName", "Email", "DateCreated", "Status"]);
    sheet.getRange(1, 1, 1, 7).setFontWeight("bold");
  }
  return sheet;
}

// Salted SHA-256, stored as "salt$hexHash". Not bcrypt/scrypt-grade, but a
// large improvement over plain text and enough for this internal tool.
function hashPassword_(password, salt) {
  salt = salt || Utilities.getUuid();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + salt, Utilities.Charset.UTF_8);
  const hex = digest.map(function (b) {
    return ((b < 0 ? b + 256 : b).toString(16)).padStart(2, "0");
  }).join("");
  return salt + "$" + hex;
}

function verifyPassword_(password, stored) {
  const parts = (stored || "").toString().split("$");
  if (parts.length !== 2) return false;
  return hashPassword_(password, parts[0]) === stored;
}

function findUserRow_(sheet, username) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const usernames = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const target = (username || "").toString().trim().toLowerCase();
  return usernames.findIndex(function (u) { return u.toString().trim().toLowerCase() === target; });
}

function getSession_(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get(token);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// ── Self-signup: role must be "User" or "Evaluator" (Admin is never
// self-registrable — see createInitialAdmin() / createAdminAccount()).
function registerAccount(data) {
  data = data || {};
  const username = (data.username || "").toString().trim();
  const password = (data.password || "").toString();
  const fullName = (data.fullName || "").toString().trim();
  const email    = (data.email || "").toString().trim();
  const role     = (data.role || "").toString().trim();

  if (!username || !password || !fullName || !email) {
    return { success: false, message: "Please fill in all fields." };
  }
  if (role !== "User" && role !== "Evaluator") {
    return { success: false, message: "Invalid role for self-registration." };
  }
  if (password.length < 6) {
    return { success: false, message: "Password must be at least 6 characters." };
  }

  const sheet = getUsersSheet_();
  if (findUserRow_(sheet, username) !== -1) {
    return { success: false, message: "Username is already taken." };
  }

  const status = (role === "Evaluator") ? "Pending" : "Active";
  const dateCreated = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
  sheet.appendRow([username, hashPassword_(password), role, fullName, email, dateCreated, status]);

  if (status === "Pending") {
    return {
      success: true,
      status: status,
      message: "Account created. Your Evaluator account is pending Admin approval before you can log in."
    };
  }
  return { success: true, status: status, message: "Account created. You may now log in." };
}

function loginAccount(data) {
  data = data || {};
  const username = (data.username || "").toString().trim();
  const password = (data.password || "").toString();
  if (!username || !password) return { success: false, message: "Please enter your username and password." };

  const sheet = getUsersSheet_();
  const rowIdx = findUserRow_(sheet, username);
  if (rowIdx === -1) return { success: false, message: "Invalid username or password." };

  const row = sheet.getRange(rowIdx + 2, 1, 1, 7).getValues()[0];
  const storedHash = row[1];
  const role       = row[2];
  const fullName   = row[3];
  const email      = row[4];
  const status     = row[6];

  if (!verifyPassword_(password, storedHash)) {
    return { success: false, message: "Invalid username or password." };
  }
  if (status !== "Active") {
    return { success: false, message: "This account is pending Admin approval and cannot log in yet." };
  }

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(
    token,
    JSON.stringify({ username: username, role: role, fullName: fullName, email: email }),
    SESSION_DURATION_SECONDS
  );
  return { success: true, token: token, role: role, fullName: fullName, username: username, email: email };
}

function logoutAccount(token) {
  if (token) CacheService.getScriptCache().remove(token);
  return { success: true };
}

// Lets the frontend restore role/name after a page refresh, given the token
// it kept in localStorage.
function getMySession(token) {
  const session = getSession_(token);
  if (!session) return { success: false, message: "Session expired. Please log in again." };
  return { success: true, role: session.role, fullName: session.fullName, username: session.username, email: session.email || "" };
}

// ── User role: only their own submissions (matched by the email address
// on their account, so applicants should submit using that same email).
// Admin/Evaluator get the full list, same as getAllSubmissions().
function getMySubmissions(token) {
  const session = getSession_(token);
  if (!session) return { success: false, message: "Session expired. Please log in again." };

  const all = getAllSubmissions();
  if (session.role === "Admin" || session.role === "Evaluator") {
    return { success: true, submissions: all };
  }

  const usersSheet = getUsersSheet_();
  const rowIdx = findUserRow_(usersSheet, session.username);
  const myEmail = rowIdx !== -1
    ? (usersSheet.getRange(rowIdx + 2, 5).getValue() || "").toString().trim().toLowerCase()
    : "";

  const filtered = myEmail
    ? all.filter(function (r) { return (r.emailAddress || "").toString().trim().toLowerCase() === myEmail; })
    : [];
  return { success: true, submissions: filtered };
}

// ── Admin-only: manage accounts ──────────────────────────────────────────────
function listUsers(token) {
  const session = getSession_(token);
  if (!session || session.role !== "Admin") return { success: false, message: "Access denied." };

  const sheet = getUsersSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, users: [] };

  const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const users = data.map(function (row) {
    return { username: row[0], role: row[2], fullName: row[3], email: row[4], dateCreated: row[5], status: row[6] };
  });
  return { success: true, users: users };
}

function setUserStatus(token, username, newStatus) {
  const session = getSession_(token);
  if (!session || session.role !== "Admin") return { success: false, message: "Access denied." };
  if (newStatus !== "Active" && newStatus !== "Pending" && newStatus !== "Disabled") {
    return { success: false, message: "Invalid status." };
  }

  const sheet = getUsersSheet_();
  const rowIdx = findUserRow_(sheet, username);
  if (rowIdx === -1) return { success: false, message: "User not found." };

  sheet.getRange(rowIdx + 2, 7).setValue(newStatus);
  return { success: true, message: "Account '" + username + "' is now " + newStatus + "." };
}

// Lets an existing Admin create additional Admin accounts (Admins are never
// self-registrable through registerAccount()).
function createAdminAccount(token, data) {
  const session = getSession_(token);
  if (!session || session.role !== "Admin") return { success: false, message: "Access denied." };

  data = data || {};
  const username = (data.username || "").toString().trim();
  const password = (data.password || "").toString();
  const fullName = (data.fullName || "").toString().trim();
  const email    = (data.email || "").toString().trim();
  if (!username || !password || !fullName || !email) {
    return { success: false, message: "Please fill in all fields." };
  }
  if (password.length < 6) return { success: false, message: "Password must be at least 6 characters." };

  const sheet = getUsersSheet_();
  if (findUserRow_(sheet, username) !== -1) return { success: false, message: "Username is already taken." };

  const dateCreated = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
  sheet.appendRow([username, hashPassword_(password), "Admin", fullName, email, dateCreated, "Active"]);
  return { success: true, message: "Admin account '" + username + "' created." };
}

// Lets any logged-in account (Admin/Evaluator/User) change their own
// password — this is how the placeholder createInitialAdmin() password
// gets replaced with a real one after first login.
function changePassword(token, oldPassword, newPassword) {
  const session = getSession_(token);
  if (!session) return { success: false, message: "Session expired. Please log in again." };

  newPassword = (newPassword || "").toString();
  if (newPassword.length < 6) return { success: false, message: "New password must be at least 6 characters." };

  const sheet = getUsersSheet_();
  const rowIdx = findUserRow_(sheet, session.username);
  if (rowIdx === -1) return { success: false, message: "Account not found." };

  const storedHash = sheet.getRange(rowIdx + 2, 2).getValue();
  if (!verifyPassword_((oldPassword || "").toString(), storedHash)) {
    return { success: false, message: "Current password is incorrect." };
  }

  sheet.getRange(rowIdx + 2, 2).setValue(hashPassword_(newPassword));
  return { success: true, message: "Password changed successfully." };
}

// ── Evaluator/Admin-only: decide Approved/Rejected (or reset to Pending),
// with an optional remarks note, logged in a new "Evaluation Remarks"
// column (Q) so the original 16-column SchoolData layout is undisturbed.
function evaluateApplication(token, schoolId, decision, remarks) {
  const session = getSession_(token);
  if (!session || (session.role !== "Evaluator" && session.role !== "Admin")) {
    return { success: false, message: "Access denied." };
  }
  if (decision !== "Approved" && decision !== "Rejected" && decision !== "Pending") {
    return { success: false, message: "Invalid decision." };
  }

  const message = updateStatus(schoolId, decision);

  if (remarks) {
    const ss    = SpreadsheetApp.openById("1Yc-DDDU8muIS5HR0OWoLclUnK6RGPrcVe_ydYlgWOYI");
    const sheet = ss.getSheetByName("SchoolData");
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
      const rowIndex = ids.findIndex(function (v) { return v.toString().trim() === schoolId.toString().trim(); });
      if (rowIndex !== -1) {
        if (!sheet.getRange(1, 17).getValue()) sheet.getRange(1, 17).setValue("Evaluation Remarks");
        const stamp = "[" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm") +
          " - " + (session.fullName || session.username) + "]: " + remarks;
        sheet.getRange(rowIndex + 2, 17).setValue(stamp);
      }
    }
  }

  return { success: true, message: message };
}

// ── ONE-TIME SETUP ────────────────────────────────────────────────────────
// Run this ONCE from the Apps Script editor — select "createInitialAdmin"
// in the function dropdown at the top, then click ▶ Run — to create your
// own Admin account. Change the four values below to your own first, then
// run it. Running it again later is harmless: it just skips if that
// username already exists.
function createInitialAdmin() {
  const ADMIN_USERNAME = "admin";
  const ADMIN_PASSWORD = "ChangeThisPassword123";
  const ADMIN_FULLNAME = "SMME Admin";
  const ADMIN_EMAIL    = "romblon.sgod.smmes@deped.gov.ph";

  const sheet = getUsersSheet_();
  if (findUserRow_(sheet, ADMIN_USERNAME) !== -1) {
    Logger.log("Admin account '" + ADMIN_USERNAME + "' already exists — skipped.");
    return;
  }
  const dateCreated = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
  sheet.appendRow([ADMIN_USERNAME, hashPassword_(ADMIN_PASSWORD), "Admin", ADMIN_FULLNAME, ADMIN_EMAIL, dateCreated, "Active"]);
  Logger.log("Admin account '" + ADMIN_USERNAME + "' created successfully.");
}

// ── APPLICATION_TYPE_FILE_MAP ─────────────────────────────────────────────────
// Maps each Application Type (as shown in the sub-menu) to the Drive fileId of
// its corresponding official form. These files live in the shared Drive folder:
// https://drive.google.com/drive/folders/1HtZ_lmJoqnJgSms4H9PCBnkUoIQC8GNA
const APPLICATION_TYPE_FILE_MAP = {
  "APPLICATION FOR CONVERSION OF A HIGH SCHOOL CLASSIFIED AS NON-IMPLEMENTING UNIT INTO A HIGH SCHOOL CLASSIFIED": "1_Y0A2ihnns41O7bZUOW-NygpT8WZI1J0",
  "APPLICATION FOR CONVERSION OF A REGULAR SCHOOL TO SCIENCE SCHOOL": "16uQT_yqQGT88twyP0vGISduHYxhxfsXU",
  "APPLICATION FOR CONVERSION OF A REGULAR SCHOOL TO TECHVOC SCHOOL": "1S340r-KOL4rMzL-XtYuLe3fW2nEGHBND",
  "APPLICATION FOR CONVERSION OF A SCHOOL INTO AN INTEGRATED SCHOOL THRU EXPANSION": "1G9NHH_J4WAH7NXv5qwOGJNWxHFHMAl3K",
  "APPLICATION FOR CONVERSION OF A SCHOOL INTO AN INTEGRATED SCHOOL THRU MERGING": "1t7Y4iXC7wZNEN7_yWkljO4edg5artNiI",
  "APPLICATION FOR ESTABLISHMENT OF PUBLIC ELEMENTARY SECONDARY SCHOOL": "1uvgx8DOtl_3rHaD7ReDqJp9W6CkEMPbK",
  "APPLICATION FOR MERGING OF SCHOOL": "1aArNyUBg5Mp17Mt95yziySwfyD5PMsfD",
  "APPLICATION FOR SEPARATION OF SCHOOL ANNEX": "1LPOclXUkh2b7FcIaU70z6gXpj-ACapUm",
  "APPLICATION FOR CONVERSION OF EXISTING ELEMENTARY AND JUNIOR HIGH SCHOOL (JHS) INTO SENIOR HIGH SCHOOL (SHS)": "1M9Vb2CxvgvPK7rcL_pFNZhi6aHCgmDVk",
  "APPLICATION FOR IMPLOF SENIOR HS-SHS-PROGRAM-IN-EXISTING-JUNIOR-HIGH-SCHOOLS-JHSs-AND-INTEGRATED-SCHOOLS": "1nCjTrRx7xC5XHTxaCIV3OfUj6ZGRvKum",
  "APPLICATION FOR THE ESTABLISHMENT OF A STAND-ALONE SENIOR HIGH SCHOOL (SHS)": "1NM3K3yehrcINfcdEBs7oN6GDiMI0D5QG",
  "PROCESSING SHEET ON THE APPLICATION FOR ESTABLISHMENT OF NEW PRIVATE SCHOOL": "1MpR6edPi9ZI-ax5LhA2eL6BZQDCyQ5tV",
  "PROCESSING SHEET ON THE APPLICATION FOR GOVERNMENT RECOGNITION OF PRIVATE SCHOOL": "1EB6_HvBeXtNTcTZrsRtZFTPgo6AOOSyZ",
  "PROCESSING SHEET ON THE APPLICATION FOR RENEWAL OF GOVERNMENT PERMIT TO OPERATE PRIVATE SCHOOL": "1wXHVWTb9wwABzYzpSEmGQVxqUGjxsvE2",
  "APPLICATION FOR ADDITIONAL TRACKS, STRANDS": "1RfyVwMz819gE6MAmKtCCFyJu2GQakRn8",
  "PROCESSING SHEET ON THE APPLICATION FOR RECOGNITION FOR SPECIAL PROGRAM FOR ARTS": "1ftMiwPg9x6BzOzYcfTTte7LJlHUb5KKc",
  "PROCESSING SHEET ON THE APPLICATION FOR SPECIAL PROGRAM FOR SPORTS": "1Q_BGKwk-7Ct1LBHQgqMo09TSK7m3GLPW",
  "PROCESSING SHEET ON THE APPLICATION FOR INCREASE OF TUITION AND OTHER SCHOOL FEES": "1UzNU40Ac-7XwgkfOk0TGu9DV9bKwh72A",
  "PROCESSING SHEET ON THE APPLICATION FOR VOLUNTARY PERMANENT CLOSURE": "1pQm1ahSDTJEhExsY_sgJRQfzGmCDv5sc",
  "PROCESSING SHEET ON THE APPLICATION FOR ISSUANCE SPECIAL ORDER FOR GRADUATION": "1fouxzecBEZhGj0w4X0BTFCZZivt3jILL",
  "PROCESSING SHEET ON THE APPLICATION FOR PRIVATE SENIOR HIGH SCHOOL (SHS) IMPLEMENTATION": "1PlKSjLtgUqnBCL-WVFCoN-uQ4jDZ_-6e",
  "PROCESSING SHEET ON THE APPLICATION FOR ADDITIONAL GRADE LEVEL or COURSE OF PRIVATE SCHOOL": "1_x8rI68OGLgTzQHQ9w5aWr5Cp-lWrrqq"
};

// ── VERIFIED_REQUIREMENTS ──────────────────────────────────────────────────────
// Hand-verified Criteria / Required Documents / MOV data, transcribed directly
// from the official DepEd form so it always renders correctly and instantly —
// no live Google Docs parsing needed for these entries. Each requirement item
// is either a plain string, or { text, sub:[...] } for a nested sub-list.
// Add more entries here as each application type's form is verified.
const VERIFIED_REQUIREMENTS = {
  "APPLICATION FOR MERGING OF SCHOOL": [
    {
      "criteria": "1. The schools to be merged are listed in EBEIS.",
      "requirements": [
        "DepEd School IDs of the schools to be merged"
      ]
    },
    {
      "criteria": "2. Both schools must be adjacent to each other (i.e. they are contiguous, compact, or located directly in front of the other or separated by a road)",
      "requirements": [
        "Map, preferably drawn to scale, showing the distances of the existing schools within the catchment area of the proposed new school, duly certified by the Municipal/City Engineer and validated by the Schools Division Office"
      ]
    },
    {
      "criteria": "3. Each of the schools must have less than 100 enrollees and inadequate equipment and resources to support the operation of both schools.",
      "requirements": [
        "Letter-request on the proposed merging of schools addressed to the SDS.",
        "Feasibility study on the proposed merging of schools, duly endorsed by the SDS.",
        {
          "text": "Proposed School's Implementation Plan, as merged, covering five (5) years to include among others, the following:",
          "sub": [
            "Current and projected enrolment for five (5) school years, by grade level",
            "Proposed budgetary requirements for its Personal Services, MOOE, and Capital Outlays;",
            "Strategic Plan re: curriculum and instructional supervision of the proposed school as merged; and",
            "School Site Development Plan (SSDP) of the schools to be merged, including the proposed school building, as needed."
          ]
        },
        "Inventory of Learning Resources (LRs) prepared by the Property Custodian of both schools to be merged.",
        "Updated PSIPOP of both schools to be merged.",
        "Updated Status Report of the schools to be merged with regard to their existing crucial resources."
      ]
    },
    {
      "criteria": "4. The SDS and School Heads concerned must agree on the merging of necessary teaching and non-teaching items as well as other crucial resources of the merged school.",
      "requirements": [
        "Duly notarized MOA on merging of schools, drawn up by and between the SDS and School Heads concerned indicating among others, the crucial resources for the proposed merged schools. (Refer to Annex E-3 for the sample MOA template)"
      ]
    },
    {
      "criteria": "5. The SDS shall designate an OIC/TIC who will be assigned to the proposed schools to be merged.",
      "requirements": [
        "Designation Order for the OIC/TIC of the merged schools, duly signed by the SDS."
      ]
    },
    {
      "criteria": "6. The proposed merging of schools must be supported by the LGU.",
      "requirements": [
        "Sangguniang Bayan/ Panlungsod Resolution supporting the merging of schools, duly approved by the Municipal/City Mayor, indicating therein the proposed name of the school.",
        "Certification from the LGU signed by the Municipal/City Mayor, as the case may be, where the LGU shall continue to provide funds for the operation and maintenance of the merged schools."
      ]
    },
    {
      "criteria": "7. School sites of both schools are named in favor of DepED",
      "requirements": [
        "Any document such as but not limited to Deed of Donation, Deed of Sale or Contract of Usufruct for 50 years executed in favor of DepED; Original Certificate of Title (OCT) or Transfer Certificate of Title (TCT) in the name of DepED, reflecting the sizes and boundaries of the sites of both schools."
      ]
    },
    {
      "criteria": "8. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "APPLICATION FOR CONVERSION OF A HIGH SCHOOL CLASSIFIED AS NON-IMPLEMENTING UNIT INTO A HIGH SCHOOL CLASSIFIED": [
    {
      "criteria": "1. The school must have a Principal position per latest PSIPOP and at least twenty (20) teachers.",
      "requirements": [
        "School's latest and updated PSIPOP"
      ]
    },
    {
      "criteria": "2. The school must have an agency code and designated/appointed financial staff (Bookkeeper and Disbursing Officer); and capability to comply with the submission of financial report to oversight agencies such as COA, DBM, NEDA, Senate, House of Representatives, etc.",
      "requirements": [
        "Approval of School's Agency Code by DBM",
        "Designation documents duly signed by the School Head",
        "Certificates of Training attended by the designated/appointed financial staff related to financial management",
        "Certification of the School Head as to the capability of the school to comply with the submission of financial reports to oversight agencies such as COA, DBM, NEDA, House of Representatives, etc."
      ]
    },
    {
      "criteria": "3. With at least Php 6 million appropriations based on current General Appropriation Act (i.e. PS, MOOE, and CO)",
      "requirements": [
        "Copy of the current GAA where the appropriation of the school is reflected.",
        "EBEIS data on enrolment per grade level for the current school year."
      ]
    },
    {
      "criteria": "4. The proposed conversion was requested by the School Head, and reviewed/evaluated and endorsed by the Division and Regional Offices before forwarding the same to DepED Central Office.",
      "requirements": [
        "Letter-request from the School Head addressed to the Schools Division Office.",
        "Endorsement letter from the Schools Division Office to Regional Office.",
        "Endorsement letter from the Regional Office to DepED Central Office."
      ]
    },
    {
      "criteria": "5. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "APPLICATION FOR CONVERSION OF A REGULAR SCHOOL TO SCIENCE SCHOOL": [
    {
      "criteria": "1. The school must meet the performance rating including, but not limited to the following:\n• Results in the National Achievement Test (NAT) for the past three (3) years must be average of 80 Mean Percentage (MPS)\n• Earned or gained Awards from International, National, or Regional Mathematics and Science Competitions",
      "requirements": [
        "Certification of (NAT) Results for the past 3 years from the National Education and Testing Research Center (NETRC)/Bureau of Education Assessment",
        "Certification from the organizers of International/National/Regional Mathematics and Science competitions."
      ]
    },
    {
      "criteria": "2. Must offer a Science, Mathematics and English enriched curriculum to all students, in addition to the K to 12 curriculum.",
      "requirements": [
        "Current School Program, signed by the School Head and approved by the Schools Division Superintendent (SDS).",
        "Copy of curriculum guide and special science curriculum."
      ]
    },
    {
      "criteria": "3. School Head must possess any of the following:\na. Holder of Master's Degree in Science/Mathematics Education with relevant training(s) in the field of administration, supervision, leadership or management for at least 72 hours; or",
      "requirements": [
        "Certified true copies of the Transcript of Records of School Head."
      ]
    },
    {
      "criteria": "b. Holder of Master's Degree in the field of administration, supervision, leadership or management with at least 120 hours Special training in Science/Mathematics at the international, national and/or regional level in Teacher training institutions duly recognized by DepEd, including DOST and UP-NISMED.",
      "requirements": [
        "Certified true copies of Certificates of Training in Science/Mathematics subject attended by the School Head."
      ]
    },
    {
      "criteria": "4. Teachers in Science and Mathematics of the school must possess the following:\na. Graduates of Bachelor of Secondary Education degree major in Science/Mathematics or its equivalent; and\nb. With relevant training in Science/Mathematics for at least 40 hours;",
      "requirements": [
        "Certified true copies of the Transcript of Records of Science and Mathematics teachers.",
        "Copy of the PRC-LET Ratings of teachers indicating their field of specialization/concentration (i.e. Mathematics, Physical Science, Biological Science, Chemistry, General Science, etc.)",
        "Certified true copies of Certificates of Relevant Training attended by Teachers (e.g. Certification Program or other related trainings for non-major Math & Science teachers).",
        "Updated Teachers' Profile"
      ]
    },
    {
      "criteria": "5. Crucial learning resources are adequate (e.g. science and computer laboratories, equipment, apparatus, instructional materials, references, etc.)",
      "requirements": [
        "Certificate on the availability of learning resources signed by the school head attested by the SDS",
        "Inventory of learning resources prepared by the School's Property Custodian, and validated by the Schools Division Office"
      ]
    },
    {
      "criteria": "6. The proposed conversion of the school must be supported by the LGU.",
      "requirements": [
        "Sangguniang Bayan/Panlungsod Resolution supporting the conversion of the school, duly approved by the Municipal/City Mayor, indicating therein the proposed name of the school."
      ]
    },
    {
      "criteria": "8. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "APPLICATION FOR ESTABLISHMENT OF PUBLIC ELEMENTARY SECONDARY SCHOOL": [
    {
      "criteria": "1. School to be established is an urgent need in the area to be served as indicated in the project feasibility study:\n• Kindergarten to Grade 6 - at least one (1) school for every barangay\n• Grades 7 to 10 - at least one (1) for every municipality/city",
      "requirements": [
        "Letter request to open a school addressed to the Schools Division Superintendent (SDS), either from PTA or Barangay Council.",
        {
          "text": "Feasibility study, duly recommended/endorsed by the SDS, indicating the following:",
          "sub": [
            "Justification on the need to establish a school;",
            "Proposed Organizational Structure and Staffing Pattern;",
            "School Environment (environmental scanning/situational analysis);",
            "Proposed School Development Plan; and",
            "Proposed Budget/Budgetary Requirements (to cover the proposed school's crucial resources)."
          ]
        },
        "Division Inspection Report (RO-QAD-F-041) signed by SDS"
      ]
    },
    {
      "criteria": "2. The proposed establishment of school must be supported by the LGU.",
      "requirements": [
        "Sangguniang Bayan/Panglungsod Resolution supporting the establishment of school, duly approved by the Municipal/City Mayor, indicating therein the proposed name of the school."
      ]
    },
    {
      "criteria": "3. The proposed school must have at least 10 pupils/students composed of one or more grade levels.",
      "requirements": [
        "List of prospective enrollees per grade level, indicating their names, ages, addresses and/or school where they are currently or were enrolled.",
        "Justification by the SDS on the need to establish a school, if necessary."
      ]
    },
    {
      "criteria": "4. There is no private high school participating in the Government Assistance to Students and Teachers in Private Education (GASTPE) Program of DepED; or the GASTPE recipient school(s) has reached its allocation or number of available slots. In case where the aforementioned criteria is not met, the SDS shall make the necessary justification.",
      "requirements": [
        "Certification from the SDS that no private high school within the Municipality/City is participating in the GASTPE Program of DepED, or that GASTPE participating high school has reached its allocation or number of available slots;",
        "Justification by the SDS on the need to establish a public school to cater to the elementary school graduates/students who cannot afford to enroll in a private high school."
      ]
    },
    {
      "criteria": "5. The proposed school to be established is not within the 2-km and 1 km radius from any existing public school in rural and urban areas, respectively. However, this limitation may be waived where existing public schools within the 2 or 1 km radius, as the case may be, can no longer accommodate students seeking admission, is geographically inaccessible, or necessary in the best interest of education as justified by the SDS.",
      "requirements": [
        "Map, preferably drawn to scale, showing the distance of the existing schools within the catchment area of the proposed new school, duly certified by the Municipal/City Engineer.",
        "Certification from the Municipal/City Engineer that the proposed school is not within the 2-km radius (for rural areas) or 1 km radius (for urban areas) from any existing public elementary/high school;",
        "Justification by the SDS for the waiver on the 2 or 1 km radius requirement."
      ]
    },
    {
      "criteria": "6. Existence and availability of a school site of at least 5,000 square meters or one half (1/2) hectare for rural areas; 2,500 square meters for highly urbanized cities.",
      "requirements": [
        "Any document such as but not limited to Deed of Donation, Deed of Sale or Contract of Usufruct for 50 years executed in favor of DepED; Original Certificate of Title (OCT) or Transfer Certificate of Title (TCT) in the name of DepED, reflecting the size and boundaries of the school site; OR",
        "Justification from the SDS in case the required size of school site cannot be met."
      ]
    },
    {
      "criteria": "7. School site must not be a high-risk area characteristics of wide dude Bad elevation to avoid flooding and soil erosion, good drainage system, and safe/potable water supply.",
      "requirements": [
        "Clearance/permit from the Provincial Mines and Geosciences Bureau (MGB) and the Regional Office (RO) of the Department of Environment and Natural Resources (DENR) stating that the proposed school site is not a high-risk area."
      ]
    },
    {
      "criteria": "8. Must have at least two (2) classrooms for the initial operation of the school. Classrooms built/to be built must be in accordance with the existing DepED standards. All public elementary and high schools shall adopt the standard 7m x 9m classroom dimension regardless of its class size.",
      "requirements": [
        "School site development plan",
        "School Building plan indicating the number and technical specifications of the classrooms to be built.",
        "School building design, duly approved by DepED Education Facilities Division, Administrative Service",
        "School Building Permit issued by the Municipal/City engineer",
        "Bureau of Fire Protection (BFP) Certificate",
        "Inspection Report from Division In-Charge of Education Facilities Section, in case classrooms are already constructed"
      ]
    },
    {
      "criteria": "9. The LGU or DepED Division Office has adequate funds for its initial operation, payment for teachers' salaries allowances and other benefits, maintenance and other operating expenses.",
      "requirements": [
        {
          "text": "Duly notarized MOA by and between DepED, represented by SDS, and LGU, represented by the Municipal/City Mayor or Provincial Governor, as the case may be, where the LGU shall provide funds for, among others, the following (Refer to Annex E-1 for the sample templates):",
          "sub": [
            "Construction of the new school building(s);",
            "Procurement of educational facilities, furniture and instructional materials;",
            "Operation and maintenance for at least five (5) years or until such time when funds for the purpose are incorporated in the national budget; and",
            "Salaries of teaching and non-teaching personnel, preferably at par with the national salary rates."
          ]
        },
        "The MOA must be supported by the Sangguniang Bayan/Panlalawigan/Panlungsod Resolution for the purpose.",
        "Certification from the Schools Division Superintendent that the Schools Division Office has sufficient fund to cover resulting expenses.",
        "List of teaching and non-teaching personnel to be borrowed from the existing nearby school(s), duly identified by the respective item numbers per PSIPOP and name of school, if any."
      ]
    },
    {
      "criteria": "10. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "APPLICATION FOR CONVERSION OF A SCHOOL INTO AN INTEGRATED SCHOOL THRU MERGING": [
    {
      "criteria": "1. The elementary and secondary schools are listed in the EBEIS.",
      "requirements": [
        "DepEd School IDs"
      ]
    },
    {
      "criteria": "2. The conversion of schools into an IS must satisfy all of the following requirements:\na. There are no schools offering complete basic education within the catchment area;\nb. There are not enough items for teachers and school heads that would justify the establishment of a separate elementary and a secondary school;\nc. There are inadequate equipment and resources to support the operation of separate elementary and secondary schools;\nd. The elementary and secondary schools are adjacent or located within a radius of not more than 100 meters from each other within the same schools division; and\ne. The School Heads concerned must agree on the merging of necessary teaching and non-teaching items as well as other crucial resources of the IS.",
      "requirements": [
        "Letter-request for the conversion of schools into an IS addressed to the SDS (thru combination of existing schools).",
        "Feasibility study on the proposed merging or combination of schools, duly recommended/endorsed by the SDS.",
        {
          "text": "IS Implementation Plan covering five (5) years to include among others, the following:",
          "sub": [
            "Current and projected enrollment for five (5) school years, by grade level;",
            "Proposed budgetary requirement for its Personal Services, MOOE, and Capital Outlay;",
            "Operational Plan re: curriculum and instructional supervision of the proposed IS; and",
            "School Site Development Plan (SSDP) to include proposed school building, as needed."
          ]
        },
        "Inventory of Learning Resources (LRs) prepared by the School's Property Custodian, for both schools to be integrated.",
        "Updated PSIPOP of both schools to be integrated.",
        "Map, preferably drawn to scale, showing the distances of the existing schools within the catchment area, duly certified by the Municipal/City Engineer and validated by the Schools Division Office.",
        "Duly notarized MOA on merging or combination of schools, drawn up by and between the School Heads of both schools to be integrated indicating among others, the integration of crucial resources for the proposed IS. (Refer to Annex E-4 for the sample MOA template)."
      ]
    },
    {
      "criteria": "3. The proposed conversion of schools into an IS must be supported by the LGU.",
      "requirements": [
        "Sangguniang Bayan/Panlungsod Resolution supporting the conversion of a school into an IS, duly approved by the Municipal/City Mayor, indicating therein the proposed name of the school.",
        "Certification from the LGU signed by the Municipal/City Mayor, as the case may be, where the LGU shall continue to provide funds for the operation and maintenance for at least 5 years or until such time that such funds are incorporated in the national budget."
      ]
    },
    {
      "criteria": "4. The School Head to be designated to the IS must satisfy the DepEd-CSS Qualification Standards of a School Head for secondary school. In case where the aforementioned criteria is not met, the SDS shall make the necessary justification.",
      "requirements": [
        "Designation Order for the proposed School Head",
        "Transcript of Records, Certificates of Relevant Trainings, Service Record and Civil Service eligibility of the proposed School Head, duly certified as true copies by the Schools Division Office's Records Unit.",
        "Justification by the SDS, in case the aforementioned criterion is not met.",
        "Certification from the SDS as to the school assignment of the other School Head who will not be selected, in case both schools to be merged or combined are with existing Schools Heads."
      ]
    },
    {
      "criteria": "5. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "APPLICATION FOR CONVERSION OF A SCHOOL INTO AN INTEGRATED SCHOOL THRU EXPANSION": [
    {
      "criteria": "1. The school is listed in the EBEIS.",
      "requirements": [
        "DepED School ID"
      ]
    },
    {
      "criteria": "2. The conversion of a school into an IS must satisfy at least three (3) of the following conditions, whichever are applicable:\na. There are no schools offering complete basic education within the catchment area;\nb. There are not enough items for teachers and school heads that would justify the establishment of a separate elementary and a secondary school;\nc. There are inadequate equipment and resources to support the operation of separate elementary and secondary schools;\nd. There is difficulty in acquiring a school site for the secondary school;\ne. The number of elementary graduates does not warrant the establishment of a separate secondary school; or\nf. The elementary/secondary school has excess, functional classrooms of at least four (4) and seven (7) to accommodate high school/elementary enrollees, respectively.",
      "requirements": [
        "Letter request for the conversion",
        "Feasibility study on the proposed expansion of school, duly recommended/endorsed by the SDS",
        {
          "text": "IS Implementation Plan covering five (5) years to include among others, the following:",
          "sub": [
            "Current and projected enrollment for five (5) school years, by grade level;",
            "Proposed budgetary requirement for its Personal Services, MOOE, and Capital Outlay;",
            "Operational Plan re: curriculum and instructional supervision of the proposed Integrated School; and",
            "School Site Development Plan (SSDP) to include proposed school building, as needed."
          ]
        },
        "For item (f) criterion, a Certification signed by the School Head, duly attested by the SDS on the excess classrooms, tables, chairs and other resources to be used for the expansion of elementary or secondary school.",
        "Inventory of Learning Resources (LRs) prepared by the School's Property Custodian, as validated by the Schools Division Office.",
        "Updated PSIPOP of the concerned school.",
        "Updated Status Report with regard to the school's existing crucial resources."
      ]
    },
    {
      "criteria": "3. The proposed conversion of school into an IS must be supported by the LGU.",
      "requirements": [
        "Sangguniang Bayan/Panlungsod Resolution supporting the conversion thru expansion of a school into an IS, duly approved by the Municipal/City Mayor, indicating therein the proposed name of the school.",
        "Certification from the LGU signed by the Municipal/City Mayor, as the case may be, where the LGU shall continue to provide funds for the operation and maintenance for at least 5 years or until such time that such funds are incorporated in the national budget."
      ]
    },
    {
      "criteria": "4. The School Head to be designated to the IS must satisfy the DepEd-CSS Qualification Standards of a School Head for secondary school.",
      "requirements": [
        "Designation Order for the proposed School Head",
        "Transcript of Records, Certificates of Relevant Trainings, Service Record and Civil Service eligibility of the proposed School Head, duly certified as true copies by the Schools Division Office's Records Unit.",
        "Justification by the SDS, in case the aforementioned criterion is not met."
      ]
    },
    {
      "criteria": "5. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "APPLICATION FOR CONVERSION OF A REGULAR SCHOOL TO TECHVOC SCHOOL": [
    {
      "criteria": "1. Must offer technical-vocational course aligned with TESDA Training Regulations, in addition to the K to 12 curriculum",
      "requirements": [
        "Current School Program, signed by the School Head and approved by the Schools Division Superintendent (SDS).",
        "Copy of the Technical-Vocational Curriculum Guide (Competency-Based Curriculum) and special technical-vocational curriculum.",
        "Approval from the Office of the Undersecretary for Programs on the technical vocational course to be offered by the school, aligned with TESDA Training Regulations."
      ]
    },
    {
      "criteria": "2. The technical-vocational course being offered must be relevant to the needs of the community/local industry.",
      "requirements": [
        {
          "text": "a. Certification by the School Head that the technical-vocational course being offered:",
          "sub": [
            "is relevant to the needs of the community/local industry;",
            "has available localized curriculum in partnership with local industry/ies; and",
            "is based on specialization aligned with TESDA Training Regulations, for assessment and employment purposes."
          ]
        },
        {
          "text": "b. Feasibility Study, duly recommended by the SDS, indicating the following:",
          "sub": [
            "Need to convert into a Technical Vocational School;",
            "Current and projected enrolment for a period of five (5) years;",
            "Demand to Open a Technical-Vocational course;",
            "Organizational Structure;",
            "School Development Plan; and",
            "Proposed Budget/Budgetary Requirements."
          ]
        }
      ]
    },
    {
      "criteria": "3. School Head must have a specialization in the technical-vocational course, in addition to the DepED and CSC requirements for a regular School Head item.",
      "requirements": [
        "Certified true copy of the Transcript of Records (TOR) of School Head.",
        "Certified true copy of National Certificate (NC) or higher certificate for the technical-vocational course attained by the School Head as issued by TESDA."
      ]
    },
    {
      "criteria": "4. Technical-Vocational Teachers must have a specialization in the technical-vocational course being offered; and must be at least NC II holders as assessed by TESDA.",
      "requirements": [
        "Certified true copies of the Transcript of Records of Technical-Vocational Teachers.",
        "Certified true copies of NC II or higher certificate issued by TESDA of Technical-Vocational Teachers on special technical-vocational skills.",
        "Copies of PRC-LET Rating of teachers indicating their field of specialization/concentration",
        "Updated Teachers' Profile."
      ]
    },
    {
      "criteria": "5. Relevant learning resources are adequate (e.g. laboratories, equipment, apparatus, instructional materials, references, etc.). Laboratory/workshop must meet the training facilities for the specialization per TESDA Training Regulations.",
      "requirements": [
        "Inventory of relevant learning resources per specialization prepared by the School's Property Custodian, and validated by the Schools Division Office.",
        "Certification from the School Head that the relevant resources of the school are adequate, duly noted by the SDS."
      ]
    },
    {
      "criteria": "6. The proposed conversion of the school must be supported by the LGU.",
      "requirements": [
        "Sangguniang Bayan/Panlungsod Resolution supporting the conversion of the school, duly approved by the Municipal/City Mayor, indicating therein the proposed name of the school."
      ]
    },
    {
      "criteria": "7. Must have LGU financial support, in case the school's fund is not adequate for its daily operation as technical-vocational school.",
      "requirements": [
        "Certification from the LGU, duly signed by the Municipal/City Mayor, as the case may be, where the LGU shall provide funds for the operation and maintenance for at least 5 years or until such time when the funds for the purpose are incorporated in the national budget."
      ]
    },
    {
      "criteria": "8. Existence and availability of a school site of at least 5,000 square meters or one half (1/2) hectare for rural areas; or 2,500 square meters for highly urbanized cities; or at least two (2) hectares for industrial or agricultural technical-vocational schools.",
      "requirements": [
        "Any document such as but not limited to Deed of Donation, Deed of Sale or Contract of Usufruct for 50 years executed in favor of DepEd; Original Certificate of Title (OCT) or Transfer Certificate of Title (TCT) in the name of DepED, reflecting the size and boundaries of the school site; OR",
        "Justification from the SDS in case the required size of technical-vocational school site cannot be met."
      ]
    },
    {
      "criteria": "9. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "APPLICATION FOR IMPLOF SENIOR HS-SHS-PROGRAM-IN-EXISTING-JUNIOR-HIGH-SCHOOLS-JHSs-AND-INTEGRATED-SCHOOLS": [
    {
      "criteria": "1. The school is listed in the Enhanced Basic Education Information System (EBEIS)",
      "requirements": [
        "DepEd School Identification (ID)"
      ]
    },
    {
      "criteria": "2. There is a need for the JHS or IS to implement SHS because:\na. no other school in the division will offer the same Track/Strand the school will offer; or\nb. there is sufficient number of learners to warrant the implementation of SHS in the school, there being no other school to accommodate said learners.\nHowever, this limitation may be waived where learners seeking admission, as the case may be, can no longer be accommodated by the existing public SHS due to congestion, as justified by the SDS.",
      "requirements": [
        "Letter-request for implementation of SHS program addressed to the Schools Division Superintendent (SDS)",
        "Certification signed by the SDS stating that no public SHS is offering the same SHS Track within the catchment area",
        {
          "text": "Implementation Plan for the SHS Program covering five (5) years to include among others, the following:",
          "sub": [
            "Current and projected enrolment for five (5) school years, by grade level;",
            "Proposed budgetary requirements for its Personal Services, Maintenance and other Operating Expenses, and Capital Outlay;",
            "Operational Plan regarding curriculum and the instructional supervision of the proposed SHS; and",
            "School Site Development Plan (SSDP) to include proposed school buildings, as needed."
          ]
        },
        "Justification signed by the SDS, in case another school will offer the same SHS Track"
      ]
    },
    {
      "criteria": "3. The school has adequate facilities, equipment and other resources to support the operation of a SHS.",
      "requirements": [
        "Certification signed by the School Head, duly attested by the SDS on the excess classrooms, tables, chairs and other resources to be used for the implementation of SHS",
        "Inventory of Learning Resources (LRs) prepared by the School's Property Custodian, as validated by the Schools Division Office",
        "Updated Personal Services Itemization and Plantilla of Position of the concerned school",
        "Updated Status Report with regard to the school's existing crucial resources"
      ]
    },
    {
      "criteria": "4. The school has available space/site for at least four (4) classrooms, whether with existing classrooms considered as excess or the classrooms are still for construction. The classrooms built or to be built must be based on the standards as stipulated in DepEd Educational Facilities Manual (i.e. 7m x 9m classroom dimension).",
      "requirements": [
        "Map, preferably drawn to scale, showing the vacant lot where the proposed SHS classroom/school building will be constructed, duly certified by the City/Municipal Engineer"
      ]
    },
    {
      "criteria": "5. The proposed SHS must have the following prospective minimum enrolment for the first two years of operation. If the minimum enrolment and/or number of tracks are not satisfied, justification by the SDS on the need to establish stand-alone SHS is necessary.",
      "requirements": [
        "List of prospective enrollees in SHS per track and strand, indicating their names, Learner Reference Numbers (LRNs), where applicable, ages, addresses, school names and DepEd School Identification Numbers where they are currently or previously enrolled",
        "Justification signed by the SDS, in case the required minimum enrolment and/or number of tracks are not satisfied"
      ]
    },
    {
      "criteria": "6. The track(s) and strand(s) to be offered must be aligned with the Local Development Plans, industries and learners' interests and preferences. Track(s) and strand(s) offered in an SHS are identified and decided upon by the SDS and the Division Planning Officer, in consultation with local stakeholders and based on the direction provided by the RD and the result of their internal and external assessments.",
      "requirements": [
        "List and types of establishments and industries in the community, as attested to by the Department of Trade and Industry (DTI), Department of Labor and Employment (DOLE) or the Municipal Planning Officer",
        "Certification from the SDS that the track(s) and strand(s) to be offered are aligned with the Local Development Plan, as evident in the list provided by the City/Municipal Mayor, and are decided upon by the Regional Director (RD), SDS, Division Planning Officer and the School Head concerned",
        "Results of internal assessments or surveys done with the prospective enrollees",
        "List of tracks and strands to be offered, duly signed by the RD or SDS, Planning Officer and School Head"
      ]
    },
    {
      "criteria": "7. There are willing and able partners to provide sufficient venues for Immersion for all SHS learners.",
      "requirements": [
        "MOA executed between the SDS and the partner entity enumerating the respective roles of both parties",
        "Immersion Deployment Plan"
      ]
    },
    {
      "criteria": "8. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "APPLICATION FOR CONVERSION OF EXISTING ELEMENTARY AND JUNIOR HIGH SCHOOL (JHS) INTO SENIOR HIGH SCHOOL (SHS)": [
    {
      "criteria": "1. The school is listed in the Enhanced Basic Education Information System (EBEIS)",
      "requirements": [
        "DepEd School Identification (ID)"
      ]
    },
    {
      "criteria": "2. There is a need for the JHS or IS to implement SHS because:\na. no other school in the division will offer the same Track/Strand the school will offer; or\nb. there is sufficient number of learners to warrant the implementation of SHS in the school, there being no other school to accommodate said learners.\nHowever, this limitation may be waived where learners seeking admission, as the case may be, can no longer be accommodated by the existing public SHS due to congestion, as justified by the SDS.",
      "requirements": [
        "Letter-request for implementation of SHS program addressed to the Schools Division Superintendent (SDS)",
        "Certification signed by the SDS stating that no public SHS is offering the same SHS Track within the catchment area",
        {
          "text": "Implementation Plan for the SHS Program covering five (5) years to include among others, the following:",
          "sub": [
            "Current and projected enrolment for five (5) school years, by grade level;",
            "Proposed budgetary requirements for its Personal Services, Maintenance and other Operating Expenses, and Capital Outlay;",
            "Operational Plan regarding curriculum and the instructional supervision of the proposed SHS; and",
            "School Site Development Plan (SSDP) to include proposed school buildings, as needed."
          ]
        },
        "Justification signed by the SDS, in case another school will offer the same SHS Track",
        {
          "text": "Certification duly signed by the SDS as to compliance of the following conditions:",
          "sub": [
            "Learners are not denied access to Elementary and JHS education as a result of the conversion;",
            "Prior consultation with both internal and external stakeholders is conducted for the purpose by the SDS and School Head of the concerned elementary or JHS;",
            "Health and safety of any learner is not compromised as a result of the conversion and subsequent transfer of elementary and/or JHS learners, taking into consideration the distance for travel to and from the new school site; and",
            "Affected school personnel shall not be displaced and demoted, and shall be transferred to the nearest school where their services are needed."
          ]
        }
      ]
    },
    {
      "criteria": "3. The school has adequate facilities, equipment and other resources to support the operation of a SHS.",
      "requirements": [
        "Certification signed by the School Head, duly attested by the SDS on the excess classrooms, tables, chairs and other resources to be used for the implementation of SHS",
        "Inventory of Learning Resources (LRs) prepared by the School's Property Custodian, as validated by the Schools Division Office",
        "Updated Personal Services Itemization and Plantilla of Position of the concerned school",
        "Updated Status Report with regard to the school's existing crucial resources"
      ]
    },
    {
      "criteria": "4. The school has available space/site for at least four (4) classrooms, whether with existing classrooms considered as excess or the classrooms are still for construction. The classrooms built or to be built must be based on the standards as stipulated in DepED Educational Facilities Manual (i.e. 7m x 9m classroom dimension).",
      "requirements": [
        "Map, preferably drawn to scale, showing the vacant lot where the proposed SHS classroom/school building will be constructed, duly certified by the City/Municipal Engineer"
      ]
    },
    {
      "criteria": "5. The proposed SHS must have the following prospective minimum enrolment for the first two years of operation. If the minimum enrolment and/or number of tracks are not satisfied, justification by the SDS on the need to establish stand-alone SHS is necessary.",
      "requirements": [
        "List of prospective enrollees in SHS per track and strand, indicating their names, Learner Reference Numbers (LRNs), where applicable, ages, addresses, school names and DepEd School Identification Numbers where they are currently or previously enrolled",
        "Justification signed by the SDS, in case the required minimum enrolment and/or number of tracks are not satisfied"
      ]
    },
    {
      "criteria": "6. The track(s) and strand(s) to be offered must be aligned with the Local Development Plans, industries and learners' interests and preferences. Track(s) and strand(s) offered in an SHS are identified and decided upon by the SDS and the Division Planning Officer, in consultation with local stakeholders and based on the direction provided by the RD and the result of their internal and external assessments.",
      "requirements": [
        "List and types of establishments and industries in the community, as attested to by the Department of Trade and Industry (DTI), Department of Labor and Employment (DOLE) or the Municipal Planning Officer",
        "Certification from the SDS that the track(s) and strand(s) to be offered are aligned with the Local Development Plan, as evident in the list provided by the City/Municipal Mayor, and are decided upon by the Regional Director (RD), SDS, Division Planning Officer and the School Head concerned",
        "Results of internal assessments or surveys done with the prospective enrollees",
        "List of tracks and strands to be offered, duly signed by the RD or SDS, Planning Officer and School Head"
      ]
    },
    {
      "criteria": "7. There are willing and able partners to provide sufficient venues for Immersion for all SHS learners.",
      "requirements": [
        "MOA executed between the SDS and the partner entity enumerating the respective roles of both parties",
        "Immersion Deployment Plan"
      ]
    },
    {
      "criteria": "8. The proposed conversion of the school into an SHS must be supported by the LGU.",
      "requirements": [
        "Sangguniang Bayan/Panlungsod Resolution signifying Local Government Unit support to the conversion of school into a SHS, duly approved by the Municipal/City Mayor"
      ]
    },
    {
      "criteria": "9. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "APPLICATION FOR SEPARATION OF SCHOOL ANNEX": [
    {
      "criteria": "1. The school annex is listed in the EBEIS.",
      "requirements": [
        "DepED School ID"
      ]
    },
    {
      "criteria": "2. With legal basis on its establishment",
      "requirements": [
        "Approval on the establishment of the school annex by DepED Central/Regional Office"
      ]
    },
    {
      "criteria": "3. The proposed separation of the school annex must be supported by the LGU",
      "requirements": [
        "Sangguniang Bayan/Panlungsod Resolution supporting the separation of the school annex, duly approved by the Municipal/City Mayor, indicating therein the proposed name of the school"
      ]
    },
    {
      "criteria": "4. Separation of the school annex shall be requested by the school head of the mother school and/or is recommended/endorsed by the SDS. In the event that all the requirements for a separation of school annex are met, and the School Head of the mother school refuses to enter into a MOA with the OIC/TIC of the school annex, the SDS shall require the School Head of the mother school to submit his/her justifications in writing. If the SDS finds the justification not valid, the SDS shall prepare and submit all the requirements even without execution of a MOA. If the SDS finds the justification valid, the SDS shall submit all pertinent documents in connection with the proposed separation of school annex to the Regional Director who shall decide whether or not to proceed with the separation of the school annex.",
      "requirements": [
        "Request for separation of the school annex concerned, duly recommended/endorsed by the Schools Division Superintendent and/or stakeholders.",
        {
          "text": "Feasibility study, indicating the following:",
          "sub": [
            "Justification on the need to separate the school annex;",
            "Proposed Organizational Structure;",
            "School Environment (environmental scanning/situational analysis);",
            "Proposed School Development Plan; and",
            "Proposed Budget/Budgetary Requirements."
          ]
        },
        "Inventory of crucial resources to be transferred to the proposed school to be separated, duly signed by the mother school's Property Custodian.",
        {
          "text": "Duly notarized MOA regarding the separation of school annex, drawn up by and between the School Head of the mother school and Officer-in-Charge (OIC)/Teacher-In-Charge (TIC) of the school annex, indicating among others, the transfer of crucial resources to the proposed regular school, to wit (Refer to Annex E-2 for the sample MOA template):",
          "sub": [
            "Teaching and non-teaching items, pursuant to the existing DepEd-DBM staffing standards for schools;",
            "Funds for Personal Services based on the actual salaries of the school personnel (both teaching and non-teaching) to be transferred;",
            "Funds for Maintenance and Other Operating Expenses (MOOE);",
            "Facilities, furniture, equipment and textbooks in all subject areas; and",
            "Other funding requirements until such time that the school's funding requirement is integrated in the General Appropriations Act (GAA)."
          ]
        },
        "Justification from the School Head or SDS in case the required MOA cannot be met.",
        "Latest and updated PSIPOP including proposal for the items for Principal I and additional teachers and support personnel."
      ]
    },
    {
      "criteria": "5. The school annex has an enrolment from Kinder to Grade 6 or Grades 7 to 10 for the current school year, with a total enrolment of at least 400 pupils/students, duly signed by the School Head/OIC and attested by the SDS. In cases where there is difficulty in meeting the aforementioned criterion, the SDS may make the necessary justification.",
      "requirements": [
        "List of enrollees by grade level, duly signed by the School Head/OIC and attested by the SDS; OR",
        "Justification from the SDS in case the aforesaid criterion cannot be met."
      ]
    },
    {
      "criteria": "6. Existence and availability of a school site of at least five thousand (5,000) square meters or one half (1/2) hectare for rural areas; 2,500 square meters for highly urbanized cities. In cases where there is difficulty in meeting the aforementioned criterion, the SDS may make the necessary justification.",
      "requirements": [
        "Any document such as but not limited to Deed of Donation, Deed of Sale or Contract of Usufruct for 50 years executed in favor of DepEd; Original Certificate of Title (OCT) or Transfer Certificate of Title (TCT) in the name of DepEd, reflecting the size and boundaries of the school site; OR",
        "Justification from the SDS in case the aforesaid criterion cannot be met."
      ]
    },
    {
      "criteria": "7. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "PROCESSING SHEET ON THE APPLICATION FOR VOLUNTARY PERMANENT CLOSURE": [
    {
      "criteria": "4. Letter of Intent or Board Resolution",
      "requirements": [
        "Signed by the School Owner/Administrator",
        "States the reason for closure",
        "Indicates the last school year of operation Duly signed by the members of the Board",
        "Notarized"
      ]
    },
    {
      "criteria": "7. Inventory and Turnover of Student Records/Certification",
      "requirements": [
        "Learners’ Permanent Records (SF10, SF9) properly compiled",
        "Transfer credentials prepared and distributed",
        "Signed by the Records Officer"
      ]
    },
    {
      "criteria": "8. Faculty and Staff Clearance/Certification",
      "requirements": [
        "List of teaching and non-teaching staff with status of separation/settlement",
        "Signed acknowledgment of receipt of final pay/benefits (if applicable)"
      ]
    },
    {
      "criteria": "4. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "PROCESSING SHEET ON THE APPLICATION FOR INCREASE OF TUITION AND OTHER SCHOOL FEES": [
    {
      "criteria": "2. Letter of Intent",
      "requirements": [
        "Addressed to the Regional Director of DepEd MIMAROPA Region",
        "Signified the intention to request for up to 10% increase only of tuition and other school fees for a particular school and year and course or grade level",
        "Signed by the School Administrator and noted by the school owner",
        "Dated at most seven days before submission."
      ]
    },
    {
      "criteria": "4. Certification from the PTA President",
      "requirements": [
        "Stated that the consultation was done not later than March 30 of every school year preceding the School Year the increase would be implemented",
        "Notarized"
      ]
    },
    {
      "criteria": "5. PTA Resolution",
      "requirements": [
        "Indicated the PTA approved amount of increase and the reasons for the increase",
        "Notarized"
      ]
    },
    {
      "criteria": "6. Minutes of General PTA Meeting",
      "requirements": [
        "Contained the following:",
        " Agenda",
        " Nature of consultation",
        " Agreement",
        " Photos",
        " Signed attendance sheet of parents/ official guardian by grade level",
        " Prepared by the Secretary, duly approved and signed by the PTA President",
        " Noted by the School Administrator"
      ]
    },
    {
      "criteria": "7. Report on Enrolment",
      "requirements": [
        "\tObserved sex segregation by course/grade level",
        "\tContained data for the last 3 years",
        "\tDuly signed by the Class Adviser and School Administrator"
      ]
    },
    {
      "criteria": "8. Proposed Tuition and Other School Fees",
      "requirements": [
        "\tFollowed and filled out the attached forms",
        "Contained the following:",
        "Amount of tuition fee",
        "Other school fees such as:",
        "Registration fee",
        "Library Fee",
        "Athletic Fee",
        "Medical/Dental Fee",
        "Guidance Fee",
        "Audio Visual Room Fee",
        "School ID",
        "Testing Materials",
        "School Organization Fee (Php 50.00)",
        "School Publication (Php 75.00)",
        "Laboratory Fees (Science,ICT, etc)",
        "Capital Development Fee",
        "Indicated the total of other school fees",
        "Indicated the grand total tuition and other school fees",
        "\tDuly signed by the PTA President and School Administrator",
        "\tNotarized"
      ]
    },
    {
      "criteria": "9. Previously issued Private Approval Form for Tuition Fee Increase",
      "requirements": [
        "\tScanned copy of the Previously issued Private Approval Form for Tuition Fee Increase",
        "\tAuthenticated by the SMME-SEPS/EPS II"
      ]
    },
    {
      "criteria": "10.Breakdown of Tuition Fee for the last 3 years",
      "requirements": [
        "\tContained tuition and other school fees for the last 3 years",
        "\tFollowed the prescribed format",
        "\tDuly signed by the School Administrator"
      ]
    },
    {
      "criteria": "11.Financial Statements",
      "requirements": [
        "\tAudited by licensed auditor",
        "Contained the following:",
        " Income statement",
        " Balance sheet",
        " Income tax return (previous year)",
        " Acknowledged Proof of Current/Updated Remittances for teachers from the following agencies:",
        " BIR",
        " SSS",
        " Phil Health",
        " Pag-IBIG"
      ]
    },
    {
      "criteria": "12.Scanned Copy of Payroll/Pay slip of Teachers",
      "requirements": [
        "\tIndicated the increase previously received by teachers and other school personnel",
        "\tTwo Sets of payroll (before and after the approval of the previous increase in tuition and other school fees)",
        "\tDuly signed by the recipients"
      ]
    },
    {
      "criteria": "11. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "PROCESSING SHEET ON THE APPLICATION FOR SPECIAL PROGRAM FOR SPORTS": [
    {
      "criteria": "2. Letter Request",
      "requirements": [
        "Addressed to the Schools Division Superintendent (SDS)",
        "Indicated the following:",
        "School address",
        "Special Program to be offered",
        "School year of implementation",
        "Duly signed by the School Head"
      ]
    },
    {
      "criteria": "4. Feasibility Study",
      "requirements": [
        "Included the following:",
        "Justification on the need to offer special program for arts",
        "Brief description of proposed Special Program for Sports (SPS), its goal and objectives",
        "Record of Sports-related school achievement",
        "Facilities and equipment",
        "Organizational structure",
        "Operational Plan (five-year)",
        "School Site Development Plan, and",
        "Budget/Budgetary Requirements (covers the schools’",
        "crucial resources)"
      ]
    },
    {
      "criteria": "5. Curriculum",
      "requirements": [
        "The school offers a four-year curriculum based on the K to 12 Basic Education Program.",
        "With emphasis on sports specialization",
        "Initially, it offers athletics and/or swimming as basic sports requirement/s.",
        "Shall offer any DepEd approved sports or any of the following sports (a minimum of five individual/dual sports and three team sports.) (please check)",
        "Individual/Dual Sports\tTeam Sports",
        "  Archery\t  Basketball",
        "  Arnis\t  Baseball",
        "  Badminton\t  Football",
        "  Chess\t  Sepak Takraw",
        "  Gymnastics\t  Softball",
        " Table Tennis\t  Volleyball",
        "  Taekwondo\t  Other DepEd",
        "Tennis\tapproved sports",
        "Other DepEd approved sports",
        "For other sports non-sanctioned by DepEd, a certification issued by SDS must be submitted.",
        "Incorporated the Independent Cooperative Learning (ICL) sessions as shown in the class program.",
        "Class program includes the following:",
        "Observed the Department’s minimum requirements on subject offered and their corresponding time allotments.",
        "Sports specialization is offered 240 minutes per week",
        "Approved and signed by the school head",
        "Evaluated and signed by the SDO SPS in-charge and CID Chief"
      ]
    },
    {
      "criteria": "6. List of Prospective SPS Learners",
      "requirements": [
        "List of enrolled learners for the SPS",
        "Class size is not more than 45 learners",
        "At least two classes per grade level.",
        "Follows the format and sex segregated",
        "Must follow maximum number of students per sports event",
        "Archery – 8",
        "Arnis – 10",
        "Athletics – 30",
        "Chess – 4",
        "Gymnastics – 11 (5 boys & 6 girls)",
        "Racket Games – 8",
        "Sepak Takraw – 12",
        "Swimming – 20",
        "Taekwando – 36",
        "Team Sports - 30",
        "Approved and signed by the school head"
      ]
    },
    {
      "criteria": "7. SPS Admission Evaluation Form (SDO Initiated-Form)",
      "requirements": [
        "All enrolled SPS learners shall be evaluated using the SDO designed evaluation form as per DO 25, s. 2015",
        "Learners shall only be admitted to the SPS program upon validation of his/her qualifications.",
        "The form shall include the following",
        "Learner’s Profile (DepEd Enrollment Form)",
        "Potential /skills in more than one school sports offered",
        "Participation in sports competitions, as attested by the elementary school principal.",
        "Physical fitness test",
        "Must include the following attachments:",
        "School Form 9 (with an Approaching Proficiency level in P.E. and Developing level in any subject",
        "Medical Certificate administered by a government physician",
        "Parental consent",
        "Certificate of good moral character",
        "Evaluated and signed by the school committee on admission",
        "Approved and signed by the school head"
      ]
    },
    {
      "criteria": "8. Inventory of sports facilities and equipment (offered either by the school or by the community)",
      "requirements": [
        "List of IMs and Sports Equipment by event with corresponding number of facilities and equipment",
        "Supported with pictures or photos",
        "Prepared by the school property custodian",
        "Duly signed by the school head"
      ]
    },
    {
      "criteria": "9. Academic and non-academic personnel",
      "requirements": [
        "List includes the school head, head teacher, teachers, coaches, and trainers.",
        "Contained the following information:",
        "Names",
        "Educational qualifications and field of specialization, preferably bachelor’s degree holder in Physical Education or Sports",
        "Qualified Teachers/Trainers/Coaches must include the following attachments:",
        "Transcript of Records",
        "Eligibility",
        "Certificates of sports-related trainings/seminars attended, and awards received as winning coach in sports",
        "Must have a very satisfactory performance rating of at least two years",
        "Certification by the School Head that the teacher/trainer/coach possesses good moral character, unquestionable integrity and",
        "commitment."
      ]
    },
    {
      "criteria": "10.Proposed Annual Budgetary Requirements and Expenditures",
      "requirements": [
        "Annual expenditures were itemized in terms of",
        "Capital expenditures (building, property, equipment, etc.)",
        "Annual budget is adequate to cover annual expenditures",
        "Dated corresponding to the school year applied for",
        "Duly signed by the School Head"
      ]
    },
    {
      "criteria": "11.Partnership Agreements (MOA)",
      "requirements": [
        "With LGU, NGOs, and/or other private stakeholders showing support and resource sharing.",
        "Duly signed by the parties",
        "Duly notarized"
      ]
    },
    {
      "criteria": "10. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "PROCESSING SHEET ON THE APPLICATION FOR RECOGNITION FOR SPECIAL PROGRAM FOR ARTS": [
    {
      "criteria": "2. Letter Request",
      "requirements": [
        "Addressed to the Schools Division Superintendent (SDS)",
        "Indicated the following:",
        "School address",
        "Special Program to be offered",
        "School year of implementation",
        "Duly signed by the School Head"
      ]
    },
    {
      "criteria": "4. Feasibility Study",
      "requirements": [
        "Included the following:",
        "Justification on the need to offer special program for arts",
        "Brief description of proposed Special Program for Arts (SPA), its goal and objectives",
        "Record of Arts-related school achievement",
        "Facilities and equipment",
        "Organizational structure",
        "Operational Plan (five-year)",
        "School Site Development Plan, and",
        "Budget/Budgetary Requirements (covers the schools’",
        "crucial resources)"
      ]
    },
    {
      "criteria": "5. Curriculum",
      "requirements": [
        "The school offers a four-year curriculum based on the K to 12 Basic Education Program.",
        "With emphasis on arts specialization",
        "Initially, it offers dance and music as basic requirements.",
        "Shall offer at least two from the following disciplines (please check)",
        "Theater Arts",
        "Creative Writing",
        "Media Arts",
        "Visual Arts",
        "Class program includes the following",
        "Observed the Department’s minimum requirements on subject offered and their corresponding time allotments.",
        "Includes the two (2) hours a day allotted for arts specialization",
        "Approved and signed by the school head",
        "Evaluated and signed by the SDO SPA in charge and CID Chief"
      ]
    },
    {
      "criteria": "6. List of Prospective SPA Learners",
      "requirements": [
        "List of enrolled learners for the SPA per specialization",
        "Class size is not more than 45 learners",
        "Follows the format and sex segregated",
        "Approved and signed by the school head"
      ]
    },
    {
      "criteria": "7. SPA Admission Form (SDO Initiated-Form)",
      "requirements": [
        "All enrolled SPA learners shall be evaluated using the SDO designed evaluation form.",
        "Learners shall only be admitted to the SPA program upon validation of his/her qualifications.",
        "The form shall include the following",
        "Learner’s Profile(DepEd Enrollment Form)",
        "Written exam score",
        "Audition score",
        "Portfolio presentation",
        "Interview",
        "Must include the following attachments",
        "School Form 9",
        "Medical Certificate administered by a government physician (optional)",
        "Birth Certificate (photocopy, PSA certified)",
        "Parental consent",
        "Certificate of good moral character",
        "Evaluated and signed by the school committee on admission",
        "Approved and signed by the school head"
      ]
    },
    {
      "criteria": "8. Inventory of arts facilities and equipment",
      "requirements": [
        "List of IMs and Arts Equipment by discipline with corresponding number of facilities and equipment",
        "Supported with pictures or photos",
        "Prepared by the school SPA coordinator",
        "Checked by the school property custodian",
        "Duly signed by the school head"
      ]
    },
    {
      "criteria": "9. Academic and non-academic personnel",
      "requirements": [
        "List includes the school head, head teacher, teachers, coaches, and trainers.",
        "Contained the following information:",
        "Names",
        "Educational qualifications and field of specialization, preferably bachelor’s degree holder in any of the following:",
        "BSE",
        "BSEED",
        "BM",
        "BS, Music, Fine Arts",
        "BA in Theater",
        "GDCE",
        "GDTA",
        "CPE",
        "BPE Major in Dance, and",
        "Other courses with at least 18 units in Education.",
        "Qualified Teachers/Trainers/Coaches must include the following attachments:",
        "Transcript of Records",
        "Eligibility",
        "Certificates in any arts discipline-related trainings/seminars attended"
      ]
    },
    {
      "criteria": "10.Proposed Annual Budgetary Requirements and Expenditures",
      "requirements": [
        "Annual expenditures were itemized in terms of",
        "Capital expenditures (building, property, equipment, etc.)",
        "Annual budget is adequate to cover annual expenditures",
        "Dated corresponding to the school year applied for",
        "Duly signed by the School Head"
      ]
    },
    {
      "criteria": "11.Partnership Agreements (MOA)",
      "requirements": [
        "With LGU, NGOs, and/or other private stakeholders showing support and resource sharing.",
        "Duly signed by parties",
        "Duly notarized"
      ]
    },
    {
      "criteria": "10. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "APPLICATION FOR ADDITIONAL TRACKS, STRANDS": [
    {
      "criteria": "4. SHS Approval Form/Provisional Permit",
      "requirements": [
        "Photocopy of all issued SHS approval forms or provisional permits for all",
        "offerings."
      ]
    },
    {
      "criteria": "5. Certification of No Conflict of Course Offerings",
      "requirements": [
        "Indicated that no Senior High School is offering the same course offering/s applied for within the catchment area or if there are, said school/s can no longer accommodate additional learners due to congestion",
        "Indicated the number of potential learners is sufficient to warrant the implementation of the SHS program in the school",
        "Included justification signed by the SDS, in case the school will offer the same SHS Track as nearby schools",
        "Signed by the Schools Division Superintendent"
      ]
    },
    {
      "criteria": "6. Inventory of learning resources/ materials/ equipment/ facilities (The school has adequate facilities, equipment and other resources to support the operation of additional track/strand/spec ialization)",
      "requirements": [
        "Indicated under each strand and/or specialization to be offered",
        "Computer units (CPU clock rate or speed, Operating System version, Microsoft Office version)",
        "Science tools, equipment and materials",
        "Strand-/Specialization-related books (Title, Author, ISBN, Date published)/Reading materials",
        "Internet facilities",
        "Prepared by the School Property Custodian",
        "Signed by the School Head or School Administrator"
      ]
    },
    {
      "criteria": "7. Personnel Services",
      "requirements": [
        "List of SHS Teachers assigned for the additional Track/Strand",
        "Duly signed by the School Head or School Administrator",
        "Copy of the National Certificate issued by TESDA for Tech-Voc teachers",
        "Copy of certificate of trainings/ seminars",
        "Transcript of Records (For private schools only)",
        "PRC License (if any)"
      ]
    },
    {
      "criteria": "8. List of Prospective Enrollees",
      "requirements": [
        "Indicated the names of prospective enrollees per track, strand and specialization, Learner Reference",
        "Number (LRN) ages, addresses, school names and DepEd School ID numbers",
        "where they are currently or previously enrolled",
        "Included justification signed by the Schools Division Superintendent in case the minimum enrolment and/or number of tracks were not satisfied.",
        "(For Public School)"
      ]
    },
    {
      "criteria": "9. List of Establishments and Industries",
      "requirements": [
        "Indicated types of establishments and industries in the Community",
        "Attested to by the Department of Trade and Industry (DTI), Department of Labor and Employment (DOLE) or the",
        "City/Municipal Planning Officer"
      ]
    },
    {
      "criteria": "10.Certification of Concurrence and Alignment of Tracks and Strands",
      "requirements": [
        "Attested to by the Schools Division Superintendent that Tracks and Strands to be offered are decided upon by the Regional Director, Schools Division Superintendent, Division Planning Officer and the School Head concerned and aligned with:",
        "Local Development Plans",
        "Industries",
        "Students’ interest and preference",
        "Included as an attachment the List of Tracks and Strands duly signed by the School Head or School Administrator"
      ]
    },
    {
      "criteria": "11.Internal Assessment/ Survey Results",
      "requirements": [
        "Indicated the result of surveys using a frequency distribution table showing the number of instances an interest or a preference was chosen",
        "Duly signed by the School Head or School Administrator"
      ]
    },
    {
      "criteria": "12.Memorandum of Agreement",
      "requirements": [
        "Executed by the Schools Administrator and the Partner Entity",
        "Included the purpose of the agreement:",
        "Engagement of stakeholders in the localization of the curriculum",
        "Provision of equipment, laboratories and workshops",
        "Organization of career guidance and youth formation activities",
        "Immersion",
        "Identified the parties involved",
        "Described the scope of the work to be done with delineation of the roles and responsibilities of the parties involved",
        "Specified the duration of the agreement",
        "Included signature of parties' principals",
        "Duly notarized"
      ]
    },
    {
      "criteria": "13.Work Immersion Deployment Plan",
      "requirements": [
        "Compliant with DepEd Order No. 30, s.",
        "2017",
        "Prepared by the work immersion coordinator",
        "Signed by the school administrator"
      ]
    },
    {
      "criteria": "11. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "PROCESSING SHEET ON THE APPLICATION FOR RENEWAL OF GOVERNMENT PERMIT TO OPERATE PRIVATE SCHOOL": [
    {
      "criteria": "1. Processing Sheet",
      "requirements": [
        "Duly accomplished and signed by the SMME-SEPS/EPS II.",
        "No information was left out by the evaluators."
      ]
    },
    {
      "criteria": "2. Endorsement",
      "requirements": [
        "Duly signed by the SDS or duly appointed OIC",
        "Dated 7 working days prior to submission to RO",
        "Consistent with the intended course/grade level as stated in the Letter of Request or Board Resolution."
      ]
    },
    {
      "criteria": "3. Letter of Request or Board Resolution",
      "requirements": [
        "Included the intended course/grade level requested for renewal of GPO. Duly signed by School Administrator/ the members of the Board"
      ]
    },
    {
      "criteria": "4. Application and Inspection Fee (Yearly)",
      "requirements": [
        "Scanned copies of the Official Receipt issued by the Division cashier in the amount of ₱2,020.00",
        "OR Number",
        "Date of payment"
      ]
    },
    {
      "criteria": "5. Photocopy of Previous Gov’t Permit",
      "requirements": [
        "Photocopy of the original GPO issued when the school was established Photocopy of the latest issued GPO Authenticated by the division in-",
        "charge of private school"
      ]
    },
    {
      "criteria": "6. Proposed Annual Budget and Annual Expenditures",
      "requirements": [
        "\tAnnual Expenditures were itemized in terms of:",
        "\tSalaries",
        "\tMiscellaneous",
        "\tCapital Expenditures (building, property, equipment)",
        "\tAnnual Budget is adequate to cover Annual Expenditures",
        "\tDuly signed by the school owner/administrator"
      ]
    },
    {
      "criteria": "7. Curriculum",
      "requirements": [
        "\tEvaluated by the Curriculum Implementation Division (CID) using the Evaluation Sheet",
        "\tMade notations if the following is compliant or not:",
        "\tSchool Calendar",
        "Conformed with the provisions",
        "of DepEd Memo",
        "With total number of school days and holidays and other activities",
        "Duly signed by the school",
        "administrator",
        "\tClass Program",
        "Observed DepEd minimum requirements on subjects offered and their corresponding time allotments",
        "Duly signed by the school",
        "administrator",
        "\tTeacher’s Program",
        "Conformed with the class",
        "program",
        "Duly signed by school",
        "administrator."
      ]
    },
    {
      "criteria": "8. Report on Enrolment",
      "requirements": [
        "\tList of learners per course/grade level",
        "\tAttained the minimum number of enrollees per grade level (at least 10 per class)"
      ]
    },
    {
      "criteria": "9. Tuition and Other School Fees",
      "requirements": [
        "Contained the following:",
        " Amount of tuition fee",
        " Other school fees such as:",
        "\tRegistration fee",
        "\tLibrary Fee",
        "\tAthletic Fee",
        "\tMedical/Dental Fee",
        "\tGuidance Fee",
        "\tAudio Visual Room Fee",
        "\tID",
        "\tTesting Materials",
        "\tSchool Organization Fee (Php 50.00)",
        "\tSchool Publication (Php 75.00)",
        "\tLaboratory Fee (Science)",
        "\tLaboratory Fee (ICT)",
        "\tCapital Development Fee",
        " Indicated the total of other school fees",
        " Indicated the grand total tuition and other school fees",
        " Notarized",
        "Note: For private schools that do not collect tuition fees, a notarized certification attesting to this fact, duly signed by the school",
        "administrator, must be submitted to the Regional Office."
      ]
    },
    {
      "criteria": "10.List of Academic and Non-Academic Personnel",
      "requirements": [
        "\tContained Updated Documents with the following information:",
        "\tNames",
        "\tEducational qualifications and field of specialization",
        "\tTranscript of Records",
        "\tWith attached Notarized individual Employment Contract indicating the job description, salaries and benefits and nature of appointment"
      ]
    },
    {
      "criteria": "11.Latest Copy of Audited Financial Statement",
      "requirements": [
        "\tContained the following:",
        "\tIncome Statement",
        "\tBalance Sheet",
        "\tPrevious Year Income Tax Return",
        "\tProof of Current /Updated remittances of teachers & other school personnel from the following agencies:",
        "\tSSS",
        "\tBIR",
        "\tPhilHealth",
        "\tPag-IBIG"
      ]
    },
    {
      "criteria": "12. Facilities and Equipment (If there are additional)",
      "requirements": [
        " Enumerated by category:",
        "\tSports/Athletic",
        "\tLaboratory",
        "\tFurniture and fixtures",
        " Included the following (with photos):",
        "\tFlagpole (in accordance with RA 8491)",
        "\tSchool gate",
        "\tPerimeter Fence",
        "\tSchool buildings/Classrooms",
        "\tRestrooms",
        "\tLaboratories",
        "\tLibrary",
        "\tMedical and Dental clinic",
        "\tGuidance Office",
        "\tCanteen",
        "\tPlayground",
        "\tStage",
        "\tOthers",
        " Prepared by the Property Custodian and signed by the school administrator"
      ]
    },
    {
      "criteria": "13.Instructional and Learning Materials (If there are additional)",
      "requirements": [
        "\tListed by learning/subject area and by grade level",
        "\tIndicated the number of copies per textbook, magazine, reference material, etc.",
        "\tPrepared by Property Custodian and signed by the school administrator"
      ]
    },
    {
      "criteria": "14. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "PROCESSING SHEET ON THE APPLICATION FOR GOVERNMENT RECOGNITION OF PRIVATE SCHOOL": [
    {
      "criteria": "4. Letter of Request and Board Resolution",
      "requirements": [
        "Included the intended course/s applied for recognition",
        "Duly signed by the members of the Board",
        "Notarized"
      ]
    },
    {
      "criteria": "5. Application and Inspection Fee",
      "requirements": [
        "\tSupported by Official Receipt issued by the Division cashier in the amount of ₱2,020.00",
        "OR Number",
        "Date of payment"
      ]
    },
    {
      "criteria": "6. Photocopy of Government Permit",
      "requirements": [
        " Photocopy of the original GPO issued when the school was established",
        "  Photocopy of the latest issued GPO",
        "  Authenticated by SMME SEPS/EPS II"
      ]
    },
    {
      "criteria": "7. School Site Ownership",
      "requirements": [
        "\tAdequacy of the school site specifying the lot area",
        "\tOne half (.5) hectare for a school with an enrolment of 50 or less students;",
        "\tOne hectare for a school with an enrolment of 1,000 to 2,000 students;",
        "\tAny document such as but not limited to Deed of Donation, Deed of Sale or Contract of Usufruct, Original Certificate of Title (OCT) or Transfer Certificate of Title (TCT)",
        "\tTotal Lot area \tsqm",
        "\tMinimum of 500 sq.m. for Kindergarten Program."
      ]
    },
    {
      "criteria": "8. Annual Budget and Expenditures",
      "requirements": [
        "\tAnnual Expenditures were itemized in terms of:",
        "\tSalaries",
        "\tMiscellaneous",
        "\tCapital Expenditures (building, property, equipment)",
        "\tAnnual Budget is adequate to cover Annual Expenditures",
        "\tDated corresponding to the school year applied for",
        "\tDuly signed by the school owner"
      ]
    },
    {
      "criteria": "9. List of Academic and Non-Academic Personnel",
      "requirements": [
        " Contained the following information:",
        "\tNames",
        "\tEligibility",
        "\tEducational qualifications and field of specialization",
        "\tTranscript of Records",
        " Notarized Employment Contract indicating the job description,",
        "salaries and benefits and nature of appointment."
      ]
    },
    {
      "criteria": "10.Audited Financial Statement",
      "requirements": [
        "\tContained the following:",
        "\tIncome Statement",
        "\tBalance Sheet",
        "\tPrevious Year Income Tax Return",
        "\tAcknowledged Current/Updated Proof of Remittances indicating the names of teachers & other school personnel from the following agencies:",
        "\tSSS",
        "\tPhilHealth",
        "\tPag-IBIG",
        "\tBIR"
      ]
    },
    {
      "criteria": "11. Facilities and Equipment",
      "requirements": [
        " Enumerated by category:",
        "\tSports/Athletic",
        "\tLaboratory",
        "\tFurniture and fixtures",
        " Included the following (with photos):",
        "\tFlagpole (in accordance with RA 8491)",
        "\tSchool gate",
        "\tPerimeter Fence",
        "\tSchool buildings/Classrooms",
        "\tRestrooms",
        "\tLaboratories",
        "\tLibrary",
        "\tMedical and Dental clinic",
        "\tGuidance Office",
        "\tCanteen",
        "\tPlayground",
        "\tStage",
        "\tOthers",
        " Prepared by the Property Custodian and signed by the school administrator"
      ]
    },
    {
      "criteria": "9. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "PROCESSING SHEET ON THE APPLICATION FOR ESTABLISHMENT OF NEW PRIVATE SCHOOL": [
    {
      "criteria": "4. Letter of Request (Sole Proprietorship) or Board Resolution (Corporation)",
      "requirements": [
        "Included the intended course/grade level to be offered and the year of implementation",
        "Duly signed by the school administrator or members of the Board"
      ]
    },
    {
      "criteria": "5. Application and Inspection Fee",
      "requirements": [
        "Scanned copies of the Official Receipt issued by the Division cashier in the amount of ₱2,020.00",
        "OR Number",
        "Date of Payment"
      ]
    },
    {
      "criteria": "6. School Bond (One-time fee for new school establishment only)",
      "requirements": [
        "Scanned copy of Official Receipt issued by the Division cashier in the amount of Php 1,000.00",
        "OR Number",
        "Date of Payment"
      ]
    },
    {
      "criteria": "7. Feasibility Study",
      "requirements": [
        "Followed the prescribed format",
        "Observed the rules of technical writing",
        "Duly signed by the school owner",
        "Contained the following:",
        "Clear description of the proposed school.",
        "Objectives, goals, and purpose of the project.",
        "Analysis of the target market or community demand.",
        "Details of location, site, and physical facilities.",
        "Resources, equipment, and materials required.",
        "Organizational structure and staffing requirements.",
        "Operational plan and policies",
        "Start-up costs, operating expenses, and projected income.",
        "Financial projections, break-even analysis, and sustainability plan.",
        "With necessary attachments such as:",
        "School Site Development Plan",
        "School Building Plan and/or Design indicating the number of and technical specifications of the classrooms",
        "Building Permit",
        "Bureau of Fire Protection Certificate"
      ]
    },
    {
      "criteria": "8. Availability of School Site",
      "requirements": [
        "Any document such as but not limited to Deed of Donation, Deed of Sale or Contract of Usufruct, Original Certificate of Title (OCT) or Transfer Certificate of Title (TCT), reflecting the size and boundaries of the school site.",
        "Adequacy of the school site specifying the lot area",
        "One half (.5) hectare for a school with an enrolment of 50 or less students;",
        "One (1) hectare for a school with an enrolment of 50 to 1,000 students;",
        "Two (2) hectares for a school with an Enrolment of 1,000 to 2,000 students.",
        "Certification from Mines and Geosciences Bureau (MGB) stating that the proposed school site is not a high-risk area."
      ]
    },
    {
      "criteria": "9. Certificate of Registration",
      "requirements": [
        "DTI-registered in case of family-administered institution offering Kindergarten only",
        "Registration Number",
        "to \tValidity Period",
        "SEC-registered for stock/non-stock education corporation",
        "□ Stock    □ Non-Stock",
        "to \tValidity Period",
        "Number of Directors/Trustees",
        "Amount of capital stock",
        "share per trustee (sufficient to cater the needs of the school for 1 year)",
        "Valid Business Permit",
        "Valid BIR registration certificate",
        "Valid SSS registration certificate",
        "Valid PhilHealth registration certificate",
        "Valid Pag-IBIG registration certificate"
      ]
    },
    {
      "criteria": "10. Proposed Annual Budget and Expenditures",
      "requirements": [
        "Annual Expenditures were itemized in terms of:",
        "Salaries",
        "Miscellaneous",
        "Capital Expenditures (building, property, equipment)",
        "Annual Budget is adequate to cover Annual Expenditures",
        "Duly signed by the school owner"
      ]
    },
    {
      "criteria": "11. Proposed Curriculum",
      "requirements": [
        "Evaluated by the Curriculum Implementation Division (CID) using the Curriculum Evaluation Sheet",
        "Made notations if the following is compliant or not:"
      ]
    },
    {
      "criteria": "11. Proposed Curriculum",
      "requirements": [
        "School Calendar",
        "Conformed with the provisions of",
        "DepEd Memo",
        "With total number of days",
        "With total number of holidays",
        "Duly signed by the school head"
      ]
    },
    {
      "criteria": "11. Proposed Curriculum",
      "requirements": [
        "Class Program",
        "Observed DepEd minimum requirements on subjects offered and their corresponding time allotment",
        "Duly signed by the school head"
      ]
    },
    {
      "criteria": "11. Proposed Curriculum",
      "requirements": [
        "Teacher’s Program",
        "Conformed with the class program",
        "Indicated the current SY",
        "Duly signed by the school head"
      ]
    },
    {
      "criteria": "12. Proposed Enrolment",
      "requirements": [
        "List of learners per course/grade level",
        "Contained the following information:",
        "Name",
        "LRN",
        "Age",
        "Address",
        "Attained the minimum number of enrollees per grade level (at least 10 per class)"
      ]
    },
    {
      "criteria": "13. Proposed Tuition and Other School Fees",
      "requirements": [
        "Contained the following:",
        "Amount of tuition fee",
        "Other school fees such as:",
        "Registration fee",
        "Library Fee",
        "Athletic Fee",
        "Medical/Dental Fee",
        "Guidance Fee",
        "Audio Visual Room Fee",
        "ID",
        "Testing Materials",
        "School Organization Fee (Php 50.00)",
        "School Publication (Php 75.00)",
        "Laboratory Fees",
        "Capital Development Fee",
        "Indicated the total of other school fees",
        "Indicated the grand total tuition and other school fees",
        "Notarized",
        "Note: For private schools that do not collect tuition fees, a notarized certification attesting to this fact, duly signed by the school administrator, must be submitted to the Regional Office."
      ]
    },
    {
      "criteria": "14. List of Academic and Non-Academic Personnel",
      "requirements": [
        "Contained the following information:",
        "Names",
        "Educational qualifications and field of specialization",
        "Transcript of Records",
        "Notarized Employment Contract indicating the job description, salaries and benefits and nature of appointment."
      ]
    },
    {
      "criteria": "15. Retirement Plan",
      "requirements": [
        "Registered with SEC or any related institution"
      ]
    },
    {
      "criteria": "16. School Policy on Anti-Bullying and Child Protection",
      "requirements": [
        "Anchored on DO No. 55, s. 2013",
        "Plan on the Promotion of Anti-bullying and Child Protection",
        "Duly signed by the school administrator"
      ]
    },
    {
      "criteria": "17. School Facilities and Equipment",
      "requirements": [
        "Enumerated by category:",
        "Sports/Athletic",
        "Laboratory",
        "Furniture and fixtures",
        "Included the following (with photos):",
        "Flagpole (in accordance with RA 8491)",
        "School gate",
        "Perimeter Fence",
        "School buildings/Classrooms",
        "Restrooms",
        "Laboratories",
        "Library",
        "Medical and Dental clinic",
        "Guidance Office",
        "Canteen",
        "Playground",
        "Stage",
        "Others",
        "Prepared by the Property Custodian and signed by the school administrator"
      ]
    },
    {
      "criteria": "18. Instructional and Learning Materials",
      "requirements": [
        "Listed by learning/subject area and by grade level",
        "Listed other reference materials",
        "Indicated the total number of copies of every learning materials/reference"
      ]
    },
    {
      "criteria": "19. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "APPLICATION FOR THE ESTABLISHMENT OF A STAND-ALONE SENIOR HIGH SCHOOL (SHS)": [
    {
      "criteria": "1. Stand-alone SHS to be established is an urgent need in the area to be served as indicated in the request or proposal.   > Grades 11 to 12 – at least one (1) public SHS for every city or municipality",
      "requirements": [
        "a. Letter-request from interested parties addressed to the SDS",
        "e.g. from PTA or Barangay Council, etc., or recommendation from the SDS to open a stand-alone SHS",
        "b. Justification on the need to establish a Stand-Alone SHS",
        "c. Track(s)/Strands to be offered as well as their respective numbers of prospective enrollees",
        ". d. School Environment (environmental scanning/situational analysis)",
        "Proposed School Improvement Plan",
        "Proposed Budget/Budgetary Requirements (to cover the proposed SHS' crucial resources)",
        "g. SHS Implementation Plan",
        "h. Division Inspection Report signed by the SDS"
      ]
    },
    {
      "criteria": "2. The proposed establishment of a Stand-Alone SHS must be supported by the LGU, provided that if the land is acquired by DepED or a private individual, this criterion is not necessary.",
      "requirements": [
        "Sangguniang Bayan/Panlungsod Resolution supporting the establishment of a stand-alone SHS, duly approved by the Municipal/City Mayor, indicating therein the Track(s) and Strand(s) to be",
        "offered and its proposed name"
      ]
    },
    {
      "criteria": "3. The proposed stand-alone SHS must have the following Prospective minimum enrolment for the first two years of operation.",
      "requirements": [
        "A. List of prospective enrollees per track and strand, indicating their names, Learner Reference Numbers (LRNs), where applicable, ages, addresses, school names and DepEd School Identification Numbers where they are currently or previously enrolled.",
        "b. Justification signed by the SDS, in case the required minimum enrolment and/or number of tracks are not satisfied"
      ]
    },
    {
      "criteria": "4. The proposed stand-alone SHS to be established is not within the parameters indicated below from any existing public schools offering SHS program.",
      "requirements": [
        "Map, preferably drawn to scale, showing the distances of the existing public schools offering SHS program within the catchment area of the proposed stand-alone SHS, duly certified by the Municipal/City Engineer",
        "Certification from the Municipal City/Engineer, duly attested by the Municipal Mayor, that the proposed stand-alone SHS is not within the 1 km radius (for urban areas), 2-km radius (for rural areas), or 3-km radius (for remote areas) from any existing public schools offering SHS program",
        "Justification by the SDS for the waiver on the 1, 2, or 3 km. radius requirement"
      ]
    },
    {
      "criteria": "5. Existence and availability of a school site as follows:",
      "requirements": [
        "Any document such as but not limited to: 1) Deed of Donation; 2) Deed of Sale;",
        "3) Contract of Usufruct for 50 years executed in favor of DepED; 4) Original Certificate of Title (OCT) or Transfer Certificate of Title (TCT) in the name of DepED; 5) Presidential Proclamation; or 6) Special Patent, reflecting the area and boundaries of the school site",
        "Justification from the SDS in case the required size of school site cannot be met"
      ]
    },
    {
      "criteria": "6. School site must not be in a high risk area (natural or man-made) in terms of land characteristics, which include good elevation to avoid flooding and soil erosion, good drainage system, and ready supply of safe, healthy and potable water",
      "requirements": [
        "a. Clearance/permit from the provincial Mines and Geosciences Bureau (MGB), Regional Office of the Department of Environment and Natural Resources (DENR), or other relevant authority(ies) stating that the proposed school site is not a high risk area and/or declared as a no-build zone"
      ]
    },
    {
      "criteria": "7. The track(s) and strand(s) to be offered must be aligned with the Local Development Plan, industries and learners’ interests and preferences.",
      "requirements": [
        "List and types of establishments and industries in the community, as attested to by the Department of Trade and Industry (DTI), Department of Labor and Employment (DOLE) or the Municipal Planning Officer",
        "Certification from the SDS that the track(s) and strand(s) to be offered are aligned with the Local Development Plan, as evident in the list provided by the City/Municipal Mayor, and decided upon by the RD or SDS and Division Planning Officer",
        "Results of internal assessments or surveys done with the prospective enrollees",
        "List of tracks and strands to be offered, duly signed by the RD or SDS, Division Planning Officer and School Head"
      ]
    },
    {
      "criteria": "8. The proposed stand-alone SHS must have the following number of classrooms for the initial operation of the SHS. Classrooms built/to be built must be in accordance with the existing DepED standards.",
      "requirements": [
        "Accomplished SHS Site Appraisal Form (refer to Annex E)",
        "SHS building plan indicating the number and technical specifications of the classrooms to be built",
        "SHS building permit issued by the Municipal/City Engineer",
        "Bureau of Fire Protection (BFP) Certificate",
        "In case classrooms are already constructed, Inspection Report from Division In- Charge of Facilities Section"
      ]
    },
    {
      "criteria": "9. There are willing and able partners to provide sufficient venues for Immersion for all SHS learners.",
      "requirements": [
        "A. MOA executed between the SDS and the partner entity enumerating the respective roles of both parties",
        "b. Immersion Deployment Plan"
      ]
    },
    {
      "criteria": "10. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "PROCESSING SHEET ON THE APPLICATION FOR ADDITIONAL GRADE LEVEL or COURSE OF PRIVATE SCHOOL": [
    {
      "criteria": "1. Letter of Request (Sole Proprietorship) or Board Resolution (Corporation)",
      "requirements": [
        "Included the intended additional course/grade level to be offered and the year of implementation",
        "Duly signed by the school administrator or members of the Board"
      ]
    },
    {
      "criteria": "2. Application and Inspection Fee",
      "requirements": [
        "Scanned copies of the Official Receipt issued by the Division cashier in the amount of ₱2,020.00",
        "OR Number",
        "Date of payment"
      ]
    },
    {
      "criteria": "3. Certificate of Registration",
      "requirements": [
        "DTI-registered in case of family-administered institution offering Kindergarten only",
        "SEC-registered for stock/non-stock education corporation",
        "Valid Business Permit",
        "Valid BIR registration certificate",
        "Valid SSS registration certificate",
        "Valid PhilHealth registration certificate",
        "Valid Pag-IBIG registration certificate"
      ]
    },
    {
      "criteria": "4. Annual Budget and Expenditures",
      "requirements": [
        "Annual Expenditures itemized in terms of Salaries, Miscellaneous, and Capital Expenditures (building, property, equipment)",
        "Annual Budget is adequate to cover Annual Expenditures",
        "Duly signed by the school owner"
      ]
    },
    {
      "criteria": "5. Curriculum",
      "requirements": [
        "Evaluated by the Curriculum Implementation Division (CID) using the Curriculum Evaluation Sheet",
        "School Calendar conformed with the provisions of DepEd Memo, with total number of days/holidays, duly signed by the school head",
        "Class Program observed DepEd minimum requirements on subjects offered and their corresponding time allotment, duly signed by the school head",
        "Teacher's Program conformed with the class program, duly signed by the school head"
      ]
    },
    {
      "criteria": "6. Prospective Enrolment",
      "requirements": [
        "List of learners per course/grade level, containing Name, LRN, Age, and Address",
        "Attained the minimum number of enrollees per grade level (at least 10 per class)"
      ]
    },
    {
      "criteria": "7. Tuition and Other School Fees",
      "requirements": [
        "Contained amount of tuition fee and other school fees (Registration, Library, Athletic, Medical/Dental, Guidance, Audio Visual Room, ID, Testing Materials, School Organization, School Publication, Laboratory, Capital Development Fee, etc.)",
        "Indicated the total of other school fees and the grand total tuition and other school fees",
        "Notarized",
        "Note: For private schools that do not collect tuition fees, a notarized certification attesting to this fact, duly signed by the school administrator, must be submitted to the Regional Office."
      ]
    },
    {
      "criteria": "8. List of Academic and Non-Academic Personnel",
      "requirements": [
        "Contained Names, Educational qualifications and field of specialization",
        "Transcript of Records",
        "Notarized Employment Contract indicating the job description, salaries and benefits and nature of appointment"
      ]
    },
    {
      "criteria": "9. School Facilities and Equipment",
      "requirements": [
        "Enumerated by category: Sports/Athletic, Laboratories, Furniture and fixtures",
        "Included the following (with photos): Flagpole (in accordance with RA 8491), School gate, Perimeter Fence, School buildings/Classrooms, Restrooms, Laboratories, Library, Medical and Dental clinic, Guidance Office, Canteen, Stage, Others",
        "Prepared by the Property Custodian and signed by the school administrator"
      ]
    },
    {
      "criteria": "10. Instructional and Learning Materials",
      "requirements": [
        "Listed by learning/subject area and by grade level",
        "Indicated the total number of copies of every learning materials/reference"
      ]
    },
    {
      "criteria": "11. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "PROCESSING SHEET ON THE APPLICATION FOR PRIVATE SENIOR HIGH SCHOOL (SHS) IMPLEMENTATION": [
    {
      "criteria": "1. Letter of Intent",
      "requirements": [
        "Addressed to the Schools Division Superintendent",
        "Signified the intention to operate the Senior High School Program/additional SHS course offerings",
        "Indicated the specific tracks, strands or specializations to be offered.",
        "Indicated the intended School Year of operation",
        "Duly signed by the school administrator",
        "Dated at most five (5) working days before the submission to the Division Office"
      ]
    },
    {
      "criteria": "2. Certification of No Conflict of Course Offerings",
      "requirements": [
        "Indicated that no public Senior High School is offering the same course offering/s applied for within the catchment area or if there are, said school/s can no longer accommodate additional learners due to congestion",
        "Indicated the number of potential learners is sufficient to warrant the implementation of the SHS program in the school",
        "Included justification signed by the SDS, in case the school will offer the same SHS Track as nearby schools",
        "Signed by the Schools Division Superintendent"
      ]
    },
    {
      "criteria": "3. Implementation Plan for the Senior High School Program",
      "requirements": [
        "Indicated Current and Projected Enrolment for five (5) years by grade level",
        "Included Proposed Budgetary Requirement for the school's Personnel Services, Maintenance and Other Operating Expenses and Capital Outlay",
        "Included Operational Plan regarding the curriculum and the instructional supervision of the proposed SHS",
        "Included School Site Development Plan to include proposed school buildings, as needed"
      ]
    },
    {
      "criteria": "4. Certification of Existing Resources",
      "requirements": [
        "Indicated the number of science laboratories, ICT laboratories, Internet facilities, TVL workshop rooms, excess classrooms, tables, chairs and other resources to be used in the implementation of the SHS Program/additional course offerings",
        "Attested to by the Schools Administrator"
      ]
    },
    {
      "criteria": "5. Inventory of Learning Resources",
      "requirements": [
        "Indicated under each strand and/or specialization to be offered: Computer units (CPU clock rate or speed, Operating System version, Microsoft Office version), Science tools, equipment and materials, Strand-/Specialization-related books (Title, Author, ISBN, Date published)/Reading materials, Internet facilities",
        "Prepared by the School Property Custodian",
        "Signed by the School Administrator"
      ]
    },
    {
      "criteria": "6. Personnel Services",
      "requirements": [
        "Copy of the National Certificate issued by TESDA for Tech-Voc teachers",
        "Transcript of Records",
        "PRC License (if any)"
      ]
    },
    {
      "criteria": "7. School Map",
      "requirements": [
        "Drawn to scale",
        "Showed the vacant lot where the proposed SHS classrooms/school building are/will be constructed",
        "Duly certified by the City/Municipal Engineer"
      ]
    },
    {
      "criteria": "8. List of Prospective Enrollees",
      "requirements": [
        "Indicated the names of prospective enrollees per track, strand and specialization, Learner Reference Numbers (LRNs), ages, addresses, school names and DepEd School ID numbers where they are currently or previously enrolled",
        "Included justification signed by the Schools Division Superintendent in case the minimum enrolment and/or number of tracks were not satisfied"
      ]
    },
    {
      "criteria": "9. List of Establishments and Industries",
      "requirements": [
        "Indicated types of establishments and industries in the Community",
        "Attested to by the Department of Trade and Industry (DTI), Department of Labor and Employment (DOLE) or the City/Municipal Planning Officer"
      ]
    },
    {
      "criteria": "10. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ],
  "PROCESSING SHEET ON THE APPLICATION FOR ISSUANCE SPECIAL ORDER FOR GRADUATION": [
    {
      "criteria": "1. Letter of Intent",
      "requirements": [
        "Addressed to the Regional Director thru Schools Division Superintendent",
        "Signified the intention to request the Issuance of SO for Graduation for a particular school and year",
        "Indicated the Total Number of Graduates per track/strand",
        "Signed by the School Administrator",
        "Dated at least fifteen (15) calendar days before the end of the current academic year"
      ]
    },
    {
      "criteria": "2. SEC Registration Certificate",
      "requirements": [
        "Copy of SEC Registration Certificate"
      ]
    },
    {
      "criteria": "3. SHS Provisional Permit",
      "requirements": [
        "Copy of the issued SHS Provisional Permit for all current offerings"
      ]
    },
    {
      "criteria": "4. SF 10 (Learners' Permanent Record)",
      "requirements": [
        "Included learners' grades at least up to 1st semester of Grade 12",
        "Certified True Copy of the SF 10 of the last school attended",
        "Certified True Copy of SF 10 of the former school, if the learner is a transferee.",
        "Certification from the School Administrator if the learner is taking summer classes at another school or a cross-enrollee of another school"
      ]
    },
    {
      "criteria": "5. Certification on the conduct of School-based Checking of Forms",
      "requirements": [
        "Must indicate that the learners' data are accurate based on their birth certificate, permanent records, and pertinent documents",
        "Certified by the School Administrator or the SDO Chairperson of the Committee on Checking of the School Forms"
      ]
    },
    {
      "criteria": "6. List of Candidates for Graduation",
      "requirements": [
        "Master List of Grade 12 Graduating Students (Alphabetical Order, mixed boys and girls)",
        "Followed the format: Last name, First name, Middle initial (Dela Cruz, Juan Pedro Carlos A.) in one column only in an excel file",
        "Duly signed by the School Registrar and School Administrator"
      ]
    },
    {
      "criteria": "7. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program",
      "requirements": [
        {
          "text": "A. Curriculum",
          "sub": [
            "Conformed with the provisions of DepEd Orders (No. 40, s. 2014; No. 51, s. 2015; No. 88, s. 2010)",
            "Has sufficient/adequate instructional and learning materials",
            {
              "text": "For Public Schools",
              "sub": [
                "Has adequate enrollees, or at least 100 pupils/students composed of one or more grade levels (SDS justification required if this is not met)",
                "List of enrollees",
                "Has enough teaching/non-teaching personnel as shown in the latest and updated PSIPOP"
              ]
            },
            {
              "text": "For Private Schools",
              "sub": [
                "Feasibility study describing how the curriculum will develop 21st century learners",
                "Curricular programs focused on the total development of learners"
              ]
            }
          ]
        },
        {
          "text": "B. School Calendar",
          "sub": [
            "Formulated in accordance with the provisions of the DepEd Memorandum",
            {
              "text": "Exhibits the following:",
              "sub": [
                "Total number of school days",
                "Total number of holidays",
                "Other school activities"
              ]
            },
            "Duly signed by the school administrators"
          ]
        },
        {
          "text": "C. Class Program",
          "sub": [
            "Observed the Department's minimum requirements on subjects offered and their corresponding time allotments",
            "Corresponds to each class",
            "Duly signed by the school head/administrator"
          ]
        },
        {
          "text": "D. Teacher's Program",
          "sub": [
            "Conformed with the Class Program",
            "Indicates the school year",
            "Duly signed by school administrators"
          ]
        }
      ]
    }
  ]
};

// ── getApplicationRequirements ────────────────────────────────────────────────
// Given an Application Type (sub-menu selection), returns its Criteria/Required
// Documents/MOV data.
//   1. If a hand-verified entry exists in VERIFIED_REQUIREMENTS, that is used —
//      guaranteed accurate, no live parsing needed (mode: "table").
//   2. Otherwise, the matching official form in Drive is opened and its tables
//      are scanned for a header row containing "Criteria" and "Required"/
//      "Document" (mode: "table", best-effort).
//   3. If neither works, a Drive preview link is returned so the client can
//      embed the document directly for manual reading (mode: "preview").
function getApplicationRequirements(applicationType) {
  const typeKey = (applicationType || "").toString().trim();
  const fileId  = APPLICATION_TYPE_FILE_MAP[typeKey];

  const previewUrl  = fileId ? "https://drive.google.com/file/d/" + fileId + "/preview" : "";
  const downloadUrl = fileId ? "https://drive.google.com/uc?export=download&id=" + fileId : "";

  // 1. Hand-verified data — fastest & always correct
  if (VERIFIED_REQUIREMENTS[typeKey]) {
    return {
      success:     true,
      mode:        "table",
      rows:        VERIFIED_REQUIREMENTS[typeKey],
      fileName:    typeKey,
      previewUrl:  previewUrl,
      downloadUrl: downloadUrl
    };
  }

  if (!fileId) {
    return { success: false, message: "No matching form found for this application type." };
  }

  try {
    const file     = DriveApp.getFileById(fileId);
    const fileName = file.getName();

    if (file.getMimeType() === MimeType.GOOGLE_DOCS) {
      const rows = extractCriteriaTable_(fileId);
      if (rows && rows.length > 0) {
        return {
          success:     true,
          mode:        "table",
          rows:        rows,
          fileName:    fileName,
          previewUrl:  previewUrl,
          downloadUrl: downloadUrl
        };
      }
    }

    // Fallback — embed the document itself for manual reading
    return {
      success:     true,
      mode:        "preview",
      fileName:    fileName,
      previewUrl:  previewUrl,
      downloadUrl: downloadUrl
    };
  } catch (err) {
    return { success: false, message: "Error loading requirements: " + err.message };
  }
}

// ── extractCriteriaTable_ ──────────────────────────────────────────────────────
// Fallback live-parser used only when an application type has no hand-verified
// entry in VERIFIED_REQUIREMENTS above. Scans a Google Doc's tables for one
// whose header row has a "Criteria" column and a "Required Documents" column.
// Handles two quirks common in these DepEd Word-to-Docs conversions:
//   • The header sometimes repeats itself on the row directly below it
//     (an artifact of a vertically-merged header cell) — those rows are skipped.
//   • A criteria's Required Documents list is sometimes split across more than
//     one physical table row, with the Criteria cell left blank on the
//     continuation row(s) — those rows are merged into the previous group.
function extractCriteriaTable_(fileId) {
  const doc  = DocumentApp.openById(fileId);
  const body = doc.getBody();
  const numChildren = body.getNumChildren();

  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.TABLE) continue;

    const table   = child.asTable();
    const numRows = table.getNumRows();
    if (numRows < 2) continue;

    // Find the header row: first row whose first cell mentions "criteria" and
    // whose second cell mentions "required"/"document".
    let headerRowIdx = -1;
    for (let r = 0; r < numRows; r++) {
      const row = table.getRow(r);
      if (row.getNumCells() < 2) continue;
      const c0 = row.getCell(0).getText().trim().toLowerCase();
      const c1 = row.getCell(1).getText().trim().toLowerCase();
      if (c0.indexOf("criteria") !== -1 && (c1.indexOf("required") !== -1 || c1.indexOf("document") !== -1)) {
        headerRowIdx = r;
        break;
      }
    }
    if (headerRowIdx === -1) continue;

    const results = [];
    for (let r = headerRowIdx + 1; r < numRows; r++) {
      const row = table.getRow(r);
      if (row.getNumCells() < 2) continue;

      const criteria      = row.getCell(0).getText().trim();
      const criteriaLower = criteria.toLowerCase();

      // Skip a duplicate/continuation header row (merged header cell artifact)
      if (criteriaLower === "criteria" || criteriaLower === "required documents") continue;

      const reqText  = row.getCell(1).getText().trim();
      const reqLines = reqText.split("\n")
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s; });

      if (criteria) {
        results.push({ criteria: criteria, requirements: reqLines });
      } else if (results.length > 0 && reqLines.length) {
        // Blank Criteria cell — continuation of the previous group
        results[results.length - 1].requirements =
          results[results.length - 1].requirements.concat(reqLines);
      }
    }
    if (results.length > 0) return results;
  }
  return [];
}

// ── updateStatus ──────────────────────────────────────────────────────────────
function updateStatus(schoolId, newStatus) {
  const ss    = SpreadsheetApp.openById("1Yc-DDDU8muIS5HR0OWoLclUnK6RGPrcVe_ydYlgWOYI");
  const sheet = ss.getSheetByName("SchoolData");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "No records found.";

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const rowIndex = values.findIndex(v => v.toString().trim() === schoolId.toString().trim());

  if (rowIndex === -1) return "School record not found.";

  sheet.getRange(rowIndex + 2, 14).setValue(newStatus);
  return "Status updated to '" + newStatus + "'.";
}

var SHEET_ID = "1H8ytPpP3Zx_-qo6TKURz9wcj6LhT4oNCKGiqQf1Qa5k";
var SHEET_NAME = "Orders";

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents || "{}");
    var submission = payload.submission || {};
    var spreadsheet = SpreadsheetApp.openById(SHEET_ID);
    var sheet = spreadsheet.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(SHEET_NAME);
    }

    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "ID",
        "Created At",
        "Topic",
        "Customer ID",
        "Name",
        "Email",
        "Phone",
        "Location",
        "Address Line 1",
        "Address Line 2",
        "Landmark",
        "City",
        "State",
        "Pincode",
        "Message",
        "Source"
      ]);
    }

    var locationText = "";
    if (submission.location) {
      var locationParts = [
        submission.location.addressLine1,
        submission.location.addressLine2,
        submission.location.landmark,
        submission.location.city,
        submission.location.state,
        submission.location.pincode
      ].filter(function(part) {
        return part && String(part).trim();
      });
      locationText = locationParts.join(", ");
    }

    sheet.appendRow([
      submission.id || "",
      submission.createdAt || "",
      submission.topic || "",
      submission.customerId || "",
      submission.name || "",
      submission.email || "",
      submission.phone || "",
      locationText,
      submission.location && submission.location.addressLine1 || "",
      submission.location && submission.location.addressLine2 || "",
      submission.location && submission.location.landmark || "",
      submission.location && submission.location.city || "",
      submission.location && submission.location.state || "",
      submission.location && submission.location.pincode || "",
      submission.message || "",
      payload.source || "medical-shop-demo"
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, message: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

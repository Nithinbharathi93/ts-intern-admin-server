import express from 'express';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import cors from 'cors';
import bodyParser from 'body-parser';

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

const PORT = 8000;


const sheetId = process.env.SHEET_ID;
const tabName = 'Users';
const range = process.env.DATA_RANGE;
const serviceAccountKeyFile = './test.json';

async function getGoogleSheetClient() {
    const auth = new google.auth.GoogleAuth({
        keyFile: serviceAccountKeyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const authClient = await auth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
}

async function readGoogleSheet(googleSheetClient, sheetId, tabName, range) {
    const res = await googleSheetClient.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${tabName}!${range}`,
    });

    const rows = res.data.values;

    if (!rows || rows.length === 0) {
        return [];
    }

    const headers = rows[0];
    const data = rows.slice(1).map(row => {
        let rowObj = {};
        headers.forEach((header, index) => {
            rowObj[header] = row[index] || null; 
        });
        return rowObj;
    });

    return data;
}

async function _writeGoogleSheet(googleSheetClient, sheetId, tabName, range, data) {
  await googleSheetClient.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tabName}!${range}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: {
      "majorDimension": "ROWS",
      "values": data
    },
  })
}

async function findRowIndexByCertNo(googleSheetClient, sheetId, tabName, range, certNo) {
  const res = await googleSheetClient.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tabName}!${range}`,
  });

  const rows = res.data.values;
  if (!rows || rows.length === 0) return -1;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === certNo) {  
      return i + 1;  
    }
  }
  return -1; 
}

app.get(process.env.GET_ALL_DATA, async (req, res) => {
    try {
        const googleSheetClient = await getGoogleSheetClient();
        const data = await readGoogleSheet(googleSheetClient, sheetId, tabName, range);
        res.json(data);
    } catch (err) {
        console.error("Google Sheets error:", err.message);
        res.status(500).json({ error: "Failed to fetch data from Google Sheets" });
    }
});

app.get(`${process.env.GET_SPECIFIC_DATA}:id`, async (req, res) => {
    try {
        const googleSheetClient = await getGoogleSheetClient();
        const data = await readGoogleSheet(googleSheetClient, sheetId, tabName, range);
        const requestedId = req.params.id.toLowerCase();
        const record = data.find(row => {
            return (row.CertNo || row.CertNo || '').toString().toLowerCase() === requestedId;
        });
        if (!record) {
            return res.status(404).json({ error: `No user found with id: ${req.params.id}` });
        }
        res.json(record);
    } catch (err) {
        console.error("Google Sheets error:", err.message);
        res.status(500).json({ error: "Failed to fetch data from Google Sheets" });
    }
});

app.post(process.env.ADD_DATA, async (req, res) => {
    try {
        const googleSheetClient = await getGoogleSheetClient();
        const { CertNo, NAME, CLASS, COURSE_NAME, Mail, MergedDocURL, LinkToMergedDoc } = req.body;
        if (!CertNo || !NAME) {
            return res.status(400).json({ error: "CertNo and NAME are required" });
        }
        const newRow = [
            CertNo,
            NAME,
            CLASS || '',
            COURSE_NAME || '',
            Mail || '',
            MergedDocURL || '',
            LinkToMergedDoc || ''
        ];
        await _writeGoogleSheet(googleSheetClient, sheetId, tabName, 'A:G', [newRow]);
        res.status(201).json({ message: "Intern added successfully" });
    } catch (err) {
        console.error("Add intern error:", err.message);
        res.status(500).json({ error: "Failed to add intern" });
    }
});

app.put(`${process.env.UPDATE_DATA}:certno`, async (req, res) => {
    try {
        const certNo = req.params.certno;
        const googleSheetClient = await getGoogleSheetClient();
        const rowIndex = await findRowIndexByCertNo(googleSheetClient, sheetId, tabName, range, certNo);

        if (rowIndex === -1) {
            return res.status(404).json({ error: `Intern with CertNo ${certNo} not found` });
        }
        const { NAME, CLASS, COURSE_NAME, Mail, MergedDocURL, LinkToMergedDoc } = req.body;
        const updatedRow = [
            certNo,
            NAME || '',
            CLASS || '',
            COURSE_NAME || '',
            Mail || '',
            MergedDocURL || '',
            LinkToMergedDoc || ''
        ];
        await googleSheetClient.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `${tabName}!A${rowIndex}:G${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [updatedRow]
            }
        });
        res.json({ message: "Intern updated successfully" });
    } catch (err) {
        console.error("Update intern error:", err.message);
        res.status(500).json({ error: "Failed to update intern" });
    }
});

app.delete(`${process.env.DELETE_DATA}:certno`, async (req, res) => {
  try {
    const certNo = req.params.certno;
    const googleSheetClient = await getGoogleSheetClient();
    const sheetsMeta = await googleSheetClient.spreadsheets.get({ spreadsheetId: sheetId });
    const sheet = sheetsMeta.data.sheets.find(s => s.properties.title === tabName);
    if (!sheet) {
      return res.status(404).json({ error: `Sheet/tab named "${tabName}" not found` });
    }
    const sheetIdNumeric = sheet.properties.sheetId;
    const rowIndex = await findRowIndexByCertNo(googleSheetClient, sheetId, tabName, range, certNo);
    if (rowIndex === -1) {
      return res.status(404).json({ error: `Intern with CertNo ${certNo} not found` });
    }
    await googleSheetClient.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      resource: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sheetIdNumeric,  
              dimension: "ROWS",
              startIndex: rowIndex - 1,  
              endIndex: rowIndex          
            }
          }
        }]
      }
    });
    res.json({ message: `Intern with CertNo ${certNo} deleted successfully` });
  } catch (err) {
    console.error("Delete intern error:", err.message);
    res.status(500).json({ error: "Failed to delete intern" });
  }
});

app.listen(PORT, () => {
    console.log(`Server listening at http://localhost:${PORT}`);
});



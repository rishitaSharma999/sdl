const express = require('express');
const multer = require('multer');
const app = express();
const cors = require('cors');

app.use(cors({
  origin: 'http://127.0.0.1:5500', // Adjust this to your frontend's origin
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

const {
  ServicePrincipalCredentials,
  PDFServices,
  MimeType,
  ExtractPDFParams,
  ExtractElementType,
  ExtractPDFJob,
  ExtractPDFResult,
  SDKError,
  ServiceUsageError,
  ServiceApiError
} = require("@adobe/pdfservices-node-sdk");
const fs = require("fs");
const AdmZip = require('adm-zip');

// Configure multer for file upload
const upload = multer({ dest: 'uploads/' });

function calculateFrequencies(texts) {
  const frequencies = {
    'A ': 0,
    'B ': 0,
    'C ': 0,
    'D ': 0,
    'E ': 0,
    'F ': 0,
    'G ': 0
  };

  texts.forEach(text => {
    Object.keys(frequencies).forEach(char => {
      // Use regex to match the character at the start of the string or after a space
      const regex = new RegExp(`(^|\\s)${char}`, 'g');
      const matches = text.match(regex);
      if (matches) {
        frequencies[char] += matches.length;
      }
    });
  });

  return frequencies;
}

// In-memory storage for frequencies
let storedFrequencies = {};

app.post('/extract-text', upload.single('File'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    console.log('File uploaded:', req.file);

    // Initial setup, create credentials instance
    const credentials = new ServicePrincipalCredentials({
      clientId: process.env.ADOBE_CLIENT_ID,
      clientSecret: process.env.ADOBE_CLIENT_SECRET
    });

    // Creates a PDF Services instance
    const pdfServices = new PDFServices({ credentials });

    // Creates an asset(s) from source file(s) and upload
    const readStream = fs.createReadStream(req.file.path);
    const inputAsset = await pdfServices.upload({
      readStream,
      mimeType: MimeType.PDF
    });

    // Create parameters for the job
    const params = new ExtractPDFParams({
      elementsToExtract: [ExtractElementType.TEXT]
    });

    // Creates a new job instance
    const job = new ExtractPDFJob({ inputAsset, params });

    // Submit the job and get the job result
    const pollingURL = await pdfServices.submit({ job });
    console.log('Polling URL:', pollingURL);

    const pdfServicesResponse = await pdfServices.getJobResult({
      pollingURL,
      resultType: ExtractPDFResult
    });

    // Get content from the resulting asset(s)
    const resultAsset = pdfServicesResponse.result.resource;
    const streamAsset = await pdfServices.getContent({ asset: resultAsset });

    // Creates a write stream and copy stream asset's content to it
    const outputFilePath = createOutputFilePath();
    console.log(`Saving asset at ${outputFilePath}`);

    const writeStream = fs.createWriteStream(outputFilePath);
    await new Promise((resolve, reject) => {
      streamAsset.readStream.pipe(writeStream)
        .on('finish', resolve)
        .on('error', reject);
    });

    // Unzip the file and read the content
    const zip = new AdmZip(outputFilePath);
    const zipEntries = zip.getEntries();
    const jsonFile = zipEntries.find(entry => entry.entryName.endsWith('.json'));

    if (!jsonFile) {
      throw new Error('No JSON file found in the zip');
    }

    const jsonContent = JSON.parse(zip.readAsText(jsonFile));

    // Extract only the "Text" field from elements
    const extractedTexts = jsonContent.elements
      .filter(element => element.Text)
      .map(element => element.Text);

    // Calculate frequencies for specific characters
    const frequencies = calculateFrequencies(extractedTexts);

    // Store the frequencies
    storedFrequencies = frequencies;

    // Clean up the uploaded file and the zip file
    fs.unlinkSync(req.file.path);
    fs.unlinkSync(outputFilePath);

    console.log('Sending response:', { extractedTexts, frequencies });
    res.header('Access-Control-Allow-Origin', 'http://127.0.0.1:5500');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.json({ extractedTexts, frequencies });

  } catch (err) {
    if (err instanceof SDKError || err instanceof ServiceUsageError || err instanceof ServiceApiError) {
      console.log("Exception encountered while executing operation", err);
      res.status(500).json({ error: `Error extracting text: ${err.message}` });
    } else {
      console.log("Exception encountered while executing operation", err);
      res.status(500).json({ error: `Error extracting text: ${err.message}` });
    }
  }
});

// GET endpoint to retrieve stored frequencies
app.get('/get-frequencies', (req, res) => {
  console.log('Sending stored frequencies:', storedFrequencies);
  res.json(storedFrequencies);
});

// Generates a string containing a directory structure and file name for the output file
function createOutputFilePath() {
  const filePath = "uploads/ExtractTextInfoFromPDF/";
  const date = new Date();
  const dateString = date.getFullYear() + "-" + ("0" + (date.getMonth() + 1)).slice(-2) + "-" +
    ("0" + date.getDate()).slice(-2) + "T" + ("0" + date.getHours()).slice(-2) + "-" +
    ("0" + date.getMinutes()).slice(-2) + "-" + ("0" + date.getSeconds()).slice(-2);
  fs.mkdirSync(filePath, { recursive: true });
  return (`${filePath}extract${dateString}.zip`);
}

app.listen(7000, () => {
  console.log('Server started on port 7000');
});
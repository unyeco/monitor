# Monitor

Monitor is a tool that displays your cryptocurrency balances in a formatted table with customizable colors and optional integration with Google Sheets.

## Installation and Setup

Follow these steps to get the Monitor tool up and running on your local machine.

### 1. Clone the Project to Your Local Machine

Open your terminal and run the following command:

```bash
git clone https://github.com/unyeco/monitor.git
```

Navigate to the project directory:

```bash
cd monitor
```

### 2. Copy Configuration Files and Update with Your Details

#### Copy `keys-example.json` to `keys.json`

Copy the example keys file:

```bash
cp keys-example.json keys.json
```

Open `keys.json` in your preferred text editor and replace the placeholder values with your own API keys.

#### Copy `config-example.json` to `config.json` (Optional, for Google Sheets integration)

Copy the example configuration file:

```bash
cp config-example.json config.json
```

Open `config.json` and update the configuration. Specifically:
- Set `"enabled": true` under the `googleAPI` section if you want to use Google Sheets integration.
- Replace `"credentialsPath"` with the path to your Google service account credentials file (see Step 3 below).
- Replace `"accountEmail"` with the email of the Google account to share the sheet with.

### 3. Set Up Google Sheets Integration (Optional)

If you want to log your balances to Google Sheets, follow these steps:

#### 3.1. Create a Google Cloud Project and Service Account

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing project.
3. Navigate to **IAM & Admin** > **Service Accounts** and click **+ CREATE SERVICE ACCOUNT**.
4. Provide a name for the service account and click **CREATE AND CONTINUE**.
5. Assign the role **Editor** and click **DONE**.

#### 3.2. Generate a Key for the Service Account

1. In the Service Accounts list, click on your newly created service account.
2. Go to the **Keys** tab and click **ADD KEY** > **Create New Key**.
3. Select **JSON** and download the key file.
4. Save the key file to your project directory or a secure location.

#### 3.3. Enable APIs for Your Project

1. Navigate to **APIs & Services** > **Library** in the Google Cloud Console.
2. Enable the following APIs:
   - Google Sheets API
   - Google Drive API

#### 3.4. Share Your Google Sheet with the Service Account

1. Create a new Google Sheet or use an existing one.
2. Share the sheet with the service account email (found in the JSON credentials file) and give it **Editor** permissions.

### 4. Edit Colors at the Top of `table.js` (Optional)

You can customize the colors used in the terminal output by editing the color configuration variables at the top of `table.js`. This step is optional.

### 5. Run the Application

Execute the following command to run the application:

```bash
node mon.js
```

---

Enjoy!

*— The unity.dev team*

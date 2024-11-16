
# Monitor

Monitor is a tool that displays your cryptocurrency balances in a formatted table with customizable colors and optional integration with Google Sheets.

## Installation and Setup

Follow these steps to get the Monitor tool up and running on your local machine.

### 1. Clone the Project

Open your terminal and run the following command:

```bash
git clone https://github.com/unyeco/monitor.git
```

Navigate to the project directory:

```bash
cd monitor
```

### 2. Copy Configuration Files and Update with Your Details

#### Copy keys-example.json to keys.json

Copy the example keys file:

```bash
cp keys-example.json keys.json
```

Open `keys.json` in your preferred text editor and replace the placeholder values with your own API keys.

#### Copy config-example.json to config.json

Copy the example configuration file:

```bash
cp config-example.json config.json
```

Open `config.json` and update the configuration as needed.

### 3. Run the Application

Execute the following command to run the application:

```bash
node mon.js
```

## Optional Configuration

### Google Sheets Integration

If you want to log your balances to Google Sheets, follow these steps:

1. **Set Up Google Cloud Credentials**

    - **Create a Google Cloud Project and Service Account**
      1. Go to the Google Cloud Console.
      2. Create a new project or select an existing project.
      3. Navigate to **IAM & Admin > Service Accounts** and click **+ CREATE SERVICE ACCOUNT**.
      4. Provide a name for the service account and click **CREATE AND CONTINUE**.
      5. Assign the role **Editor** and click **DONE**.

    - **Generate a Key for the Service Account**
      1. In the Service Accounts list, click on your newly created service account.
      2. Go to the **Keys** tab and click **ADD KEY > Create New Key**.
      3. Select JSON and download the key file.
      4. Save the key file to your project directory or a secure location.

    - **Enable APIs for Your Project**
      1. Navigate to **APIs & Services > Library** in the Google Cloud Console.
      2. Enable the following APIs:
         - Google Sheets API
         - Google Drive API

2. **Share Your Google Sheet with the Service Account**
   1. Create a new Google Sheet or use an existing one.
   2. Share the sheet with the service account email (found in the JSON credentials file) and give it **Editor** permissions.

3. **Update config.json**
   - Set `"enabled": true` under the `googleAPI` section.
   - Replace `"credentialsPath"` with the path to your Google service account credentials file.
   - Replace `"accountEmail"` with the email of the Google account to share the sheet with.

### Enabling PNL (Profit and Loss) Calculations

To enable PNL calculations, edit your `config.json` file, use local times:

```json
"pnl": {
    "enabled": true,
    "Coinbase 1": {
        "start": "2024-11-15 12:34:00",
        "balance": 5000
    },
    "Gateio 2": {
        "start": "2024-11-14 07:00:00",
        "balance": 1000
    }
}
```

### Customizing Colors

You can customize the colors used in the terminal output by editing the `"colors"` section in your `config.json` file.  Note that chalk also allows hex values as seen below.

Example Configuration:

```json
"colors": {
    "leftMarginSize": 0,
    "borderColor": "dim.gray",
    "accountNameColor": "cyan",
    "spotSymbolColor": "green",
    "futuresSymbolColor": "red",
    "defaultSymbolColor": "white",
    "amountColor": "green",
    "accountTotalColor": "cyanBright",
    "grandTotalColor": "white",
    "baseCurrencySymbolStyle": "bold",
    "futurePos": "green",
    "futureNeg": "red",
    "pnlPositive": "dim.green",
    "pnlNegative": "dim.red",
    "pnlLabelColor": "#0f0f0f"
}
```

**Notes:**
- **Chalk Color Names:** You can use any of Chalk’s predefined color names (e.g., `red`, `greenBright`, `dim.blue`).
- **Hex Colors:** Prefix hex codes with `#` and combine them with modifiers using dots (e.g., `bold.#FF5733`).

## Credits

— The unity.dev team

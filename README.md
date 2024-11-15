# Monitor

Monitor is a tool that displays your cryptocurrency balances in a formatted table with customizable colors.

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

### 2. Copy `keys-example.json` to `keys.json` and Update with Your Own Keys

Copy the example keys file:

```bash
cp keys-example.json keys.json
```

Open `keys.json` in your preferred text editor and replace the placeholder values with your own API keys.

### 3. Edit Colors at the Top of `table.js` (Optional)

You can customize the colors used in the output by editing the color configuration variables at the top of `table.js`. This step is optional.

### 4. Run the Application

Execute the following command to run the application:

```bash
node mon.js
```

---

Enjoy!

*— The unity.dev team*
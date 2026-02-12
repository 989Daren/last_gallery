# The Last Gallery - Migration Guide: PC to Chromebook

## What This Guide Does

This guide walks you through moving your entire gallery website from your PC to your Chromebook. It's written for someone who might not have done this before, so we'll explain each step clearly and warn you about common pitfalls.

**Time Required**: 45-90 minutes (depending on file transfer method and internet speed)

**Starting Point**: You have Linux enabled on your Chromebook (the Terminal app is available)

---

## Before You Start: Understanding What's Happening

Think of your website like a recipe:
- **The code** (your Flask app, HTML, CSS, JavaScript) = The recipe instructions
- **The database** (gallery.db) = The current state (what's been cooked so far)
- **The uploaded images** = The ingredients you've already prepared
- **Python packages** = The kitchen tools you need
- **Environment variables** (.env file) = Secret settings like your admin PIN

All of these need to be moved from your PC to your Chromebook. None of them care what computer they're on - they'll work exactly the same way.

---

## Part 1: Prepare Your PC (Gather Everything)

### Step 1.1: Locate Your Project Folder
On your PC, find the folder containing your gallery project. It should contain:
```
The-Last-Gallery/
├── app.py
├── db.py
├── requirements.txt
├── data/
│   └── gallery.db
├── static/
│   ├── css/
│   ├── js/
│   ├── images/
│   └── grid_full.svg
├── templates/
│   └── index.html
├── uploads/
│   └── (all your uploaded artwork images)
├── grid utilities/
│   └── repair_tiles.py
└── .env (hidden file - important!)
```

**Where is it?** If you're not sure where your project folder is:
- **Windows**: Open File Explorer, search for "app.py", look at the file location
- **Mac**: Open Finder, search for "app.py", look at the file location

### Step 1.2: Make Hidden Files Visible
You need to see hidden files (like `.env` which starts with a dot):

- **Windows**: 
  1. Open File Explorer
  2. Click the **View** tab
  3. Check the box for **Hidden items**

- **Mac**: 
  1. Open Finder
  2. Press `Cmd + Shift + .` (Command + Shift + Period)

Now look in your project folder - you should see a file called `.env`

**Pitfall Warning**: If you don't see a `.env` file, your admin PIN and any API keys might be hardcoded in `app.py`. We'll deal with this later, but make a note of it.

### Step 1.3: Create a Backup (EXTREMELY IMPORTANT!)

Before moving anything:
1. Right-click your entire project folder
2. Choose **Copy**
3. Paste it somewhere safe (Desktop, external drive, or cloud storage like Google Drive)
4. Rename the copy to something like: `The-Last-Gallery-BACKUP-Feb-11-2026`

**Why?** If anything goes wrong during migration, you have a complete working copy to return to. This is your safety net.

### Step 1.4: Document Your Current Setup

Create a text file called `migration_notes.txt` and write down:

```
MY CURRENT WEBSITE SETUP - WRITTEN ON [TODAY'S DATE]

How I currently run the website:
- Command I use: python app.py (or python3 app.py?)
- Local URL: http://127.0.0.1:5000
- Network URL: http://192.168.1.XXX:5000 (fill in your IP)

Admin PIN: 8375 (or whatever yours is)

Python version on PC: (open Command Prompt/Terminal, type: python --version)

Any email API keys I'm using: (list service name and where to find the key)

Any problems or quirks with the current setup: (anything you had to do special to make it work)
```

Save this file - it's your reference guide.

---

## Part 2: Transfer Files to Chromebook

Choose ONE of these methods (USB is recommended for simplicity):

### Option A: USB Drive Method (RECOMMENDED - Simplest and Fastest)

#### On Your PC:
1. Insert a USB drive (needs enough space for your project - check `uploads/` folder size)
2. Open File Explorer (Windows) or Finder (Mac)
3. Copy your ENTIRE project folder to the USB drive
4. Wait for the copy to complete (may take a while if you have many uploaded images)
5. Safely eject the USB drive

#### On Your Chromebook:
1. Insert the USB drive
2. Open the **Files** app (find it in your app launcher)
3. In the left sidebar, you should see your USB drive listed
4. Click on the USB drive to see your project folder
5. Right-click (or two-finger tap) on your project folder
6. Choose **Copy**
7. In the left sidebar, find and click **Linux files**
8. Right-click (or two-finger tap) in the empty space
9. Choose **Paste**
10. Wait for the copy to complete (this might take several minutes)

**Pitfall Warning #1**: Make sure you paste into **"Linux files"**, NOT "My files" or "Downloads". Only the Linux files area can run your Flask server.

**Pitfall Warning #2**: If your project folder is very large (over 8GB), consider transferring just the essential files first, then copying the `uploads/` folder separately later.

**What you should see**: In the Files app, under "Linux files", you should now have a folder (probably called "The-Last-Gallery" or whatever you named it) with all your project files inside.

---

### Option B: Google Drive Method (If No USB Drive Available)

#### On Your PC:
1. Go to [drive.google.com](https://drive.google.com)
2. Click **New** → **Folder upload**
3. Select your project folder
4. Wait for upload to complete (could take 10+ minutes depending on file size)

#### On Your Chromebook:
1. Go to [drive.google.com](https://drive.google.com)
2. Find your uploaded project folder
3. Right-click it → **Download**
4. Wait for download to complete
5. Open the **Files** app
6. Go to **Downloads** and find your project folder (it might be in a .zip file)
7. If it's a .zip file, right-click → **Extract all**
8. Copy the extracted folder
9. Navigate to **Linux files** in the sidebar
10. Paste the folder there

**Pitfall Warning**: Large uploads/downloads can fail. If this happens, try compressing the `uploads/` folder separately or use Option A.

---

### Option C: Cloud Storage (Dropbox, OneDrive, etc.)

Similar to Google Drive method:
1. Upload to your cloud storage service
2. Download on Chromebook
3. Move to Linux files

---

## Part 3: Verify the Transfer

Let's make sure everything copied correctly:

1. Open **Terminal** on your Chromebook (find it in your app launcher)
2. Type this command and press Enter:
   ```bash
   ls
   ```
   
   **What this does**: "ls" means "list" - it shows what folders are in your current location.

3. You should see your project folder name listed. If it's called "The-Last-Gallery", you should see that name.

4. Navigate into your project folder:
   ```bash
   cd The-Last-Gallery
   ```
   
   **What this does**: "cd" means "change directory" - you're moving into your project folder.
   
   **Pitfall Warning**: If your folder name has spaces (like "The Last Gallery"), you need to use quotes:
   ```bash
   cd "The Last Gallery"
   ```

5. List all the files (including hidden ones):
   ```bash
   ls -la
   ```
   
   **What this does**: Shows ALL files, including hidden ones like `.env`

6. You should see:
   - `app.py`
   - `db.py`
   - `requirements.txt`
   - Folders: `data`, `static`, `templates`, `uploads`, `grid utilities`
   - (hopefully) `.env`

**If something is missing**: Go back to your PC, make sure everything was copied to your USB drive, and try the transfer again.

---

## Part 4: Install Python and Required Tools

Now we need to set up the "kitchen" with all the tools (Python and packages).

### Step 4.1: Update Your System

In the Terminal, type these commands one at a time (press Enter after each):

```bash
sudo apt update
```

**What this does**: "sudo" means "do this as administrator", "apt" is the package installer, "update" refreshes the list of available software.

**You'll be asked**: "Do you want to continue? [Y/n]" - Type `Y` and press Enter

```bash
sudo apt upgrade
```

**What this does**: Updates all your existing software to the latest versions.

**You'll be asked**: "Do you want to continue? [Y/n]" - Type `Y` and press Enter

**Wait time**: This might take 5-10 minutes. You'll see a lot of text scrolling by - that's normal.

### Step 4.2: Install Python and Pip

```bash
sudo apt install python3 python3-pip python3-venv -y
```

**What this does**: 
- `python3` = The Python language
- `python3-pip` = Tool to install Python packages
- `python3-venv` = Tool to create virtual environments (isolated Python setups)
- `-y` = Automatically say "yes" to installation prompts

**Wait time**: 2-5 minutes

### Step 4.3: Verify Python Installation

```bash
python3 --version
```

You should see something like: `Python 3.9.2` or `Python 3.11.2` (version numbers may vary)

```bash
pip3 --version
```

You should see something like: `pip 20.3.4 from /usr/lib/python3/dist-packages/pip (python 3.9)`

**If you see these version numbers**: ✅ Success! Python is installed.

**If you see "command not found"**: ❌ Something went wrong. Re-run the install command from Step 4.2.

---

## Part 5: Install Your Project's Dependencies

Your `requirements.txt` file lists all the Python packages your project needs (Flask, Pillow, etc.). Now we'll install them.

### Step 5.1: Make Sure You're in Your Project Folder

```bash
pwd
```

**What this does**: "pwd" means "print working directory" - it shows where you are.

You should see something ending with `/The-Last-Gallery`

**If you're NOT in your project folder**:
```bash
cd ~/The-Last-Gallery
```

(Replace "The-Last-Gallery" with your actual folder name)

### Step 5.2: Create a Virtual Environment (Optional But Recommended)

This keeps your project's packages separate from the system. Think of it as a dedicated drawer for this project's tools.

```bash
python3 -m venv venv
```

**What this does**: Creates a folder called `venv` that will hold all your project's Python packages.

**Wait time**: 30 seconds to 1 minute

**Pitfall Warning**: If you see "command not found", you might need to install python3-venv:
```bash
sudo apt install python3-venv
```

### Step 5.3: Activate the Virtual Environment

```bash
source venv/bin/activate
```

**What this does**: "Turns on" the virtual environment.

**How you know it worked**: Your terminal prompt will change. You'll see `(venv)` at the beginning of the line:
```
(venv) username@penguin:~/The-Last-Gallery$
```

**Pitfall Warning**: You need to activate the virtual environment EVERY TIME you open a new Terminal window to work on your project. Get used to typing `source venv/bin/activate` when you start working.

### Step 5.4: Upgrade Pip (Inside Virtual Environment)

```bash
pip install --upgrade pip
```

**What this does**: Makes sure you have the latest version of pip (the package installer).

### Step 5.5: Install All Project Dependencies

This is the big one:

```bash
pip install -r requirements.txt
```

**What this does**: Reads your `requirements.txt` file and installs every package listed (Flask, Pillow, etc.).

**Wait time**: 2-5 minutes. You'll see lots of "Collecting...", "Downloading...", "Installing..." messages.

**What success looks like**: At the end, you'll see:
```
Successfully installed Flask-2.x.x Pillow-10.x.x ...
```

**Common Pitfalls**:

- **Error: "No such file 'requirements.txt'"**: You're not in the right folder. Use `pwd` to check, then `cd` to your project folder.

- **Error about "gcc" or "compiler"**: Some packages need compilation tools. Install them:
  ```bash
  sudo apt install build-essential python3-dev
  ```
  Then try the install command again.

- **Pillow fails to install**: You might need image libraries:
  ```bash
  sudo apt install libjpeg-dev zlib1g-dev
  pip install -r requirements.txt
  ```

---

## Part 6: Configure Your Environment

### Step 6.1: Check if .env File Transferred

```bash
ls -la
```

Look for `.env` in the list.

**If you see .env**: ✅ Great! Skip to Step 6.3

**If you DON'T see .env**: Continue to Step 6.2

### Step 6.2: Create .env File (If Missing)

If your `.env` file didn't transfer, we need to recreate it.

```bash
nano .env
```

**What this does**: Opens a text editor called "nano" to create/edit the file.

Type this (replace with your actual values):
```
TLG_ADMIN_PIN=8375
```

If you have email API keys, add them:
```
MAILERSEND_API_KEY=your_key_here_if_you_have_one
```

**How to save and exit nano**:
1. Press `Ctrl + X` (you'll see "Save modified buffer?" at the bottom)
2. Press `Y` for "Yes"
3. Press `Enter` to confirm the filename

**Pitfall Warning**: nano can be confusing at first. The `^` symbol means "Ctrl". So `^X` means "Ctrl + X".

### Step 6.3: Verify .env File Contents

```bash
cat .env
```

**What this does**: "cat" displays the file contents.

You should see your admin PIN and any API keys.

**Security Check**: Make sure this file is NOT being shared publicly or uploaded to GitHub!

---

## Part 7: Test the Database

Your database file (`gallery.db`) should have transferred with everything else.

```bash
ls data/
```

You should see: `gallery.db`

**If the file is missing**: ❌ Big problem. Go back to your PC and make sure `data/gallery.db` was copied. This file contains all your artwork data!

**If the file is there**: ✅ Good, but let's verify it's not corrupted:

```bash
sqlite3 data/gallery.db "SELECT COUNT(*) FROM assets;"
```

**What this does**: Opens your database and counts how many artworks are stored.

**If you see a number** (even 0): ✅ Database is working!

**If you see "command not found"**: Install sqlite3:
```bash
sudo apt install sqlite3
```
Then try the command again.

**If you see "database is locked" or "corrupted"**: ❌ The database file may have been damaged during transfer. Use your backup from Part 1 and try transferring again.

---

## Part 8: Run Your Website!

This is the moment of truth.

### Step 8.1: Make Sure Virtual Environment is Active

Look at your terminal prompt. Do you see `(venv)` at the start?

**If YES**: ✅ Continue

**If NO**: Activate it:
```bash
source venv/bin/activate
```

### Step 8.2: Start the Flask Server

```bash
python app.py
```

**What this does**: Runs your Flask application.

**What you should see**:
```
 * Serving Flask app 'app'
 * Debug mode: off
WARNING: This is a development server. Do not use it in a production deployment.
 * Running on http://127.0.0.1:5000
 * Running on http://100.xxx.xxx.xxx:5000
Press CTRL+C to quit
```

**Pitfall Warning**: If you see errors, read them carefully. Common issues:

- **"ModuleNotFoundError: No module named 'flask'"**: Your virtual environment isn't activated OR packages didn't install. Go back to Part 5.

- **"Address already in use"**: Something else is using port 5000. Either:
  - Find and close the other program, OR
  - Change the port in `app.py` (at the very bottom, change `port=5000` to `port=5001`)

- **"Permission denied" for port 80**: Chromebook won't let you use port 80. Stick with 5000.

### Step 8.3: Access Your Website

1. Open the **Chrome browser** on your Chromebook
2. Go to: `http://127.0.0.1:5000`

**What you should see**: Your gallery website! 🎉

**Try these things**:
- Does the wall of tiles display?
- Click on a tile - does the popup work?
- Try entering the admin PIN - does the admin modal open?

**If the page doesn't load**: 
- Check the Terminal - did the server start without errors?
- Try `http://localhost:5000` instead
- Make sure you didn't close the Terminal window (that stops the server)

---

## Part 9: Access from Your Phone/Tablet (Network Access)

Want to test on your phone like you did on your PC?

### Step 9.1: Find Your Chromebook's IP Address

In a NEW Terminal window (don't close the one running Flask), type:

```bash
ip addr show
```

Look for a line with `inet 192.168.x.xxx` (NOT 127.0.0.1). That's your Chromebook's local IP address.

Example: `192.168.1.145`

### Step 9.2: Update app.py (If Needed)

At the very bottom of `app.py`, you should see:

```python
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
```

The `host='0.0.0.0'` part allows network access.

**If it says `host='127.0.0.1'`**: Change it to `host='0.0.0.0'` and save the file.

### Step 9.3: Restart the Server

In the Terminal where Flask is running:
1. Press `Ctrl + C` to stop the server
2. Run `python app.py` again

### Step 9.4: Test from Your Phone

On your phone (connected to the SAME Wi-Fi network):
- Open a browser
- Go to: `http://192.168.x.xxx:5000` (use YOUR Chromebook's IP address)

**Pitfall Warning**: 
- Phone and Chromebook MUST be on the same Wi-Fi network
- Some Wi-Fi networks (especially public/work networks) block device-to-device connections
- If it doesn't work, try your home Wi-Fi network

---

## Part 10: Stopping and Starting Your Server

### To Stop the Server:
- In the Terminal window running Flask
- Press `Ctrl + C`

### To Start the Server Again:
1. Open Terminal
2. Navigate to your project:
   ```bash
   cd ~/The-Last-Gallery
   ```
3. Activate virtual environment:
   ```bash
   source venv/bin/activate
   ```
4. Run the app:
   ```bash
   python app.py
   ```

**Pro Tip**: Create a shortcut! Make a file called `start_gallery.sh`:

```bash
nano start_gallery.sh
```

Paste this:
```bash
#!/bin/bash
cd ~/The-Last-Gallery
source venv/bin/activate
python app.py
```

Save and exit (Ctrl+X, Y, Enter)

Make it executable:
```bash
chmod +x start_gallery.sh
```

Now you can start your server with just:
```bash
./start_gallery.sh
```

---

## Part 11: Troubleshooting Common Issues

### Issue: "My images don't show up"

**Check 1**: Did the `uploads/` folder transfer completely?
```bash
ls uploads/ | wc -l
```
This counts files. Compare to your PC's uploads folder.

**Check 2**: File permissions might be wrong:
```bash
chmod -R 755 uploads/
```

### Issue: "Database is empty/tiles don't appear"

**Check 1**: Verify database file:
```bash
sqlite3 data/gallery.db "SELECT COUNT(*) FROM tiles;"
```

**Check 2**: Database might not have migrated. Copy it from your PC again.

### Issue: "Can't access admin functions"

**Check 1**: Is your PIN in the `.env` file?
```bash
cat .env
```

**Check 2**: Restart Flask after editing `.env`:
- Ctrl+C to stop
- `python app.py` to restart

### Issue: "Server crashes when uploading images"

**Check 1**: Make sure Pillow installed correctly:
```bash
pip install Pillow --force-reinstall
```

**Check 2**: Check uploads folder permissions:
```bash
chmod -R 755 uploads/
```

### Issue: "Everything worked on PC but not Chromebook"

**Most likely causes**:
1. Virtual environment not activated
2. Packages didn't install (check `pip list`)
3. File paths are case-sensitive on Linux (check capitalization)
4. `.env` file missing or wrong

**Debug steps**:
```bash
# Are you in the right folder?
pwd

# Is venv active? (should see (venv) in prompt)
# If not:
source venv/bin/activate

# Are packages installed?
pip list | grep Flask
# Should show Flask and version

# Does .env exist?
cat .env
```

---

## Part 12: Next Steps After Migration

### Backup Your Chromebook Setup

Once everything works:
1. Make a backup of your Linux files folder
2. Store it in Google Drive or an external drive
3. Update it weekly/monthly

### (Optional) Set Up Email Sending

If you want to add the edit code feature:
1. Choose an email service (MailerSend recommended)
2. Sign up and get an API key
3. Add the key to your `.env` file:
   ```bash
   nano .env
   ```
   Add line:
   ```
   MAILERSEND_API_KEY=your_key_here
   ```
4. Install the email package:
   ```bash
   pip install mailersend
   ```
5. Update `requirements.txt`:
   ```bash
   pip freeze > requirements.txt
   ```

### Keep Everything Updated

Periodically update your system and packages:
```bash
# Update Linux system
sudo apt update && sudo apt upgrade

# Update Python packages (in your virtual environment)
pip install --upgrade pip
pip list --outdated  # See what needs updating
```

---

## Quick Reference Card

**Print this section and keep it handy!**

### Starting Your Gallery Server:
```bash
cd ~/The-Last-Gallery
source venv/bin/activate
python app.py
```

### Stopping the Server:
- Press `Ctrl + C` in the Terminal

### Accessing Your Gallery:
- On Chromebook: `http://127.0.0.1:5000`
- On Phone (same Wi-Fi): `http://YOUR_CHROMEBOOK_IP:5000`

### Finding Your Chromebook's IP:
```bash
ip addr show | grep "inet 192"
```

### Installing New Python Packages:
```bash
# Make sure venv is active first!
source venv/bin/activate
pip install package_name
pip freeze > requirements.txt  # Save the update
```

### Checking if Something Is Installed:
```bash
pip list | grep PackageName
```

### Editing Files:
```bash
nano filename.txt
# Save: Ctrl+X, then Y, then Enter
```

### Viewing Files:
```bash
cat filename.txt  # Show contents
ls  # List files in current folder
ls -la  # List ALL files including hidden
```

---

## Emergency Recovery

If EVERYTHING breaks and you need to start over:

1. **Delete the broken setup**:
   ```bash
   cd ~
   rm -rf The-Last-Gallery
   ```

2. **Start from Part 2** (Transfer Files) again using your backup

3. **Don't panic** - your backup on the PC has everything

---

## Summary Checklist

After migration, verify:
- [ ] Project files transferred to Linux files
- [ ] Python and pip installed (`python3 --version`)
- [ ] Virtual environment created and activated (see `(venv)` in prompt)
- [ ] All packages installed (`pip list` shows Flask, Pillow, etc.)
- [ ] `.env` file exists with admin PIN (`cat .env`)
- [ ] Database file exists (`ls data/gallery.db`)
- [ ] Server starts without errors (`python app.py`)
- [ ] Website loads in browser (`http://127.0.0.1:5000`)
- [ ] Can view existing artwork
- [ ] Can access admin modal
- [ ] (Optional) Can access from phone on same Wi-Fi

---

## Congratulations! 🎉

If you've made it this far and everything works, you've successfully migrated your entire gallery website to your Chromebook! 

Your website now runs exactly the same as it did on your PC. The code doesn't know or care what computer it's on - it just needs Python, the right packages, and the database file.

**Remember**: Every time you want to run your server:
1. Open Terminal
2. `cd ~/The-Last-Gallery`
3. `source venv/bin/activate`
4. `python app.py`

Keep your PC backup safe until you're confident everything works perfectly on the Chromebook!

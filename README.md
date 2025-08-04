# Server Side Access Guide
Follow the steps below to set up and run the server-side of the project locally.

---

## 1. Clone the Repository

```
git clone https://github.com/AlIfran64/Courier-and-Parcel-Management-System-Server.git
cd your-repo-folder
```

## 2. Install Dependencies
Make sure you have Node.js and npm installed. Then run:
```
npm install
```

## 3. Create a .env file in the root directory and add the necessary environment variables

## 4. Firebase Admin SDK Setup
- Go to Firebase Console.
- Create or select your Firebase project.
- Navigate to Project Settings > Service Accounts.
- Generate a new private key and download the JSON file.
- Add the credentials to your environment or server as needed.

## 5. Run the Server
```
nodemon index.js
```

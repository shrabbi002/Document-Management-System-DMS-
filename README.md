Document Management System (DMS) project based on its codebase:

🏗️ Tech Stack
Backend: Node.js with 

Express.js
 for the REST API.
Database: SQLite (sqlite3) for lightweight, local relational data storage (

dms.db
).
Frontend: Vanilla HTML, CSS, and JavaScript served statically from the 

public
 directory.
Authentication: Custom session-based authentication using token generation (crypto) and password hashing (bcryptjs).
File Handling: multer for handling multipart/form-data document uploads.
Document Parsing: mammoth for converting .docx files into HTML for in-browser viewing.
✨ Key Features
Role-Based Access Control (RBAC): Supports three user roles:
admin: Can manage users, projects, folders, and documents.
editor: Can manage projects, folders, and documents.
viewer: Read-only access to view and download documents.
Hierarchical Organization: Documents are organized using a relational structure of Projects -> Folders (which can have parent folders) -> Documents.
Document Versioning: Automatically handles versioning when a document with the same name is uploaded to the same folder (e.g., v1.0.0 -> v1.0.1).
In-Browser Document Viewer: An integrated viewer endpoint (/viewer/:id) that allows users to preview files directly in the browser without downloading them. It natively embeds PDFs, images, text/code files, and .docx documents.
Audit Logging: Every critical action (login, create, update, delete, download, view) is recorded in an audit_logs table for traceability.
Automatic Seeding: The application seeds an initial database with default admin/editor/viewer accounts and sample folders if the database is empty upon startup.

import multer from "multer";
import { AppError } from "./error.middleware";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB (as per PRD)
const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

const storage = multer.memoryStorage();

const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError(`Invalid file type. Allowed: PDF, JPEG, PNG, WebP`, 400));
  }
};

export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});

export const uploadPDF = upload.single("file");
export const uploadBulk = upload.array("files", 20);
export const uploadAvatar = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB for avatars
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError("Avatar must be JPEG, PNG, or WebP", 400));
    }
  },
}).single("avatar");

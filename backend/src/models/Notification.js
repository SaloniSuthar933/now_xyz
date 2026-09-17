import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  type: { type: String, required: true },
  dedupeKey: { type: String, required: true },
  medicineName: { type: String, required: true },
  currentQuantity: { type: Number, required: true, min: 0 },
  threshold: { type: Number, required: true, min: 0 },
  reason: { type: String, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  resolvedAt: { type: Date, default: null }
}, { timestamps: true });

notificationSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { resolvedAt: null } }
);

export default mongoose.model('Notification', notificationSchema);
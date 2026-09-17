import mongoose from 'mongoose';

const batchSchema = new mongoose.Schema({
  medicineName: { type: String, required: true, trim: true, index: true },
  batchNumber: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 0 },
  expiryDate: { type: Date, required: true, index: true },
  unitPrice: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['active', 'near-expiry', 'quarantined'], default: 'active', index: true },
  reorderThreshold: { type: Number, min: 0, default: 10 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

batchSchema.index({ medicineName: 1, expiryDate: 1 });

export default mongoose.model('Batch', batchSchema);

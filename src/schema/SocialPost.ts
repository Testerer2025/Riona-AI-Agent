import mongoose, { Schema } from 'mongoose';

const SocialPostSchema = new Schema({
  caption: { type: String, required: true },
  imageName: { type: String, required: true },
  postedAt: { type: Date, default: Date.now }
});

export default mongoose.model('SocialPost', SocialPostSchema);

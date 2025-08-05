import mongoose from 'mongoose';

// Post Schema
const PostSchema = new mongoose.Schema({
  content: { type: String, required: true },
  content_hash: { type: String, required: true, unique: true },
  image_name: { type: String, required: true },
  image_path: { type: String, required: true },
  posted_at: { type: Date, default: Date.now },
  post_type: { type: String, default: 'instagram_post' },
  success: { type: Boolean, default: true },
  similarity_score: { type: Number, default: 0 }
});

// Comment Schema
const CommentSchema = new mongoose.Schema({
  post_id: { type: String, required: true, unique: true },
  post_url: { type: String, required: true },
  post_caption: { type: String, default: '' },
  post_author: { type: String, default: '' },
  comment_text: { type: String, required: true },
  comment_hash: { type: String, required: true },
  commented_at: { type: Date, default: Date.now },
  success: { type: Boolean, default: true },
  is_own_post: { type: Boolean, default: false }
});

// Sichere Model-Erstellung
const Post = mongoose.models.Post || mongoose.model('Post', PostSchema);
const Comment = mongoose.models.Comment || mongoose.model('Comment', CommentSchema);

export { Post, Comment };

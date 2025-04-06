// backend/src/db/models/function.js
const mongoose = require('mongoose');

const FunctionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  route: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  language: {
    type: String,
    required: true,
    enum: ['javascript', 'python']
  },
  code: {
    type: String,
    required: true
  },
  timeout: {
    type: Number,
    default: 30000, // 30 seconds in milliseconds
    min: 1000,
    max: 300000 // 5 minutes
  },
  memory: {
    type: Number,
    default: 128, // 128 MB
    min: 64,
    max: 1024
  },
  active: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field on save
FunctionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Function = mongoose.model('Function', FunctionSchema);

module.exports = Function;
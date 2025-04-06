// backend/src/api/functions.js
const express = require('express');
const router = express.Router();
const Function = require('../db/models/function');

// Get all functions
router.get('/', async (req, res, next) => {
  try {
    const functions = await Function.find().select('-code');
    res.json(functions);
  } catch (error) {
    next(error);
  }
});

// Get a specific function
router.get('/:id', async (req, res, next) => {
  try {
    const func = await Function.findById(req.params.id);
    if (!func) {
      return res.status(404).json({ message: 'Function not found' });
    }
    res.json(func);
  } catch (error) {
    next(error);
  }
});

// Create a new function
router.post('/', async (req, res, next) => {
  try {
    const { name, route, language, code, timeout, memory } = req.body;
    
    // Validate input
    if (!name || !route || !language || !code) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    
    // Check if function with the same name or route already exists
    const existingFunction = await Function.findOne({ 
      $or: [{ name }, { route }] 
    });
    
    if (existingFunction) {
      return res.status(409).json({ message: 'A function with the same name or route already exists' });
    }
    
    // Create the function
    const newFunction = new Function({
      name,
      route,
      language,
      code,
      timeout,
      memory
    });
    
    await newFunction.save();
    res.status(201).json(newFunction);
  } catch (error) {
    next(error);
  }
});

// Update a function
router.put('/:id', async (req, res, next) => {
  try {
    const { name, route, language, code, timeout, memory, active } = req.body;
    
    // Find the function
    const func = await Function.findById(req.params.id);
    if (!func) {
      return res.status(404).json({ message: 'Function not found' });
    }
    
    // Update fields if provided
    if (name) func.name = name;
    if (route) func.route = route;
    if (language) func.language = language;
    if (code) func.code = code;
    if (timeout !== undefined) func.timeout = timeout;
    if (memory !== undefined) func.memory = memory;
    if (active !== undefined) func.active = active;
    
    await func.save();
    res.json(func);
  } catch (error) {
    next(error);
  }
});

// Delete a function
router.delete('/:id', async (req, res, next) => {
  try {
    const func = await Function.findByIdAndDelete(req.params.id);
    if (!func) {
      return res.status(404).json({ message: 'Function not found' });
    }
    res.json({ message: 'Function deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
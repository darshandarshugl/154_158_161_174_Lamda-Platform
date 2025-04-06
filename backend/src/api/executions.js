// backend/src/api/executions.js
const express = require('express');
const router = express.Router();
const Function = require('../db/models/function');
const { executeFunction } = require('../executors/docker');

// Execute a function by route
router.post('/:route', async (req, res, next) => {
  try {
    // Find the function by route
    const func = await Function.findOne({ route: req.params.route, active: true });
    
    if (!func) {
      return res.status(404).json({ 
        error: 'Function not found or inactive' 
      });
    }
    
    // Execute the function
    const event = {
      body: req.body,
      headers: req.headers,
      path: req.path,
      method: req.method,
      query: req.query
    };
    
    const startTime = Date.now();
    const result = await executeFunction(func, event);
    const executionTime = Date.now() - startTime;
    
    // Log execution metrics (to be implemented in Week 2)
    console.log(`Function ${func.name} executed in ${executionTime}ms`);
    
    // Return the result
    if (result.statusCode) {
      res.status(result.statusCode).json(result.body);
    } else {
      res.json(result);
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
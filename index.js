const express = require('express');
const app = express();
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

app.use(cors());
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database('./exercise.db', (err) => {
  if (err) {
    console.error('Error opening database', err);
  } else {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL
      )`);

    db.run(`
      CREATE TABLE IF NOT EXISTS exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER,
        description TEXT NOT NULL,
        duration INTEGER NOT NULL,
        date TEXT NOT NULL,
        FOREIGN KEY(userId) REFERENCES users(id)
      )`);
  }
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/index.html');
});

// POST /api/users - Create a new user
app.post('/api/users', (req, res) => {
  debugger
  const { username } = req.body;
  if (username == null || username.trim().length == 0) {
    return res.status(400).json({ error: 'Username is required and cannot be empty or whitespace only' });
  }

  // Check if username already exists
  db.get('SELECT * FROM users WHERE username = ?', [username.trim()], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (row) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Insert new user
    db.run('INSERT INTO users (username) VALUES (?)', [username.trim()], function (err) {
      if (err) {
        return res.status(500).json({ error: 'Error creating user' });
      }

      const newUser = {
        id: this.lastID,
        username: username,
      };

      res.status(201).json(newUser);
    });
  });
});

// GET /api/users - Get all users
app.get('/api/users', (req, res) => {
  db.all('SELECT * FROM users', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No users found' });
    }

    res.status(200).json(rows);
  });
});

// POST /api/users/:_id/exercises - Add an exercise for a specific user
app.post('/api/users/:_id/exercises', (req, res) => {
  const userId = parseInt(req.params._id);

  // Log the userId for debugging
  console.log('User ID:', userId);

  const { description, duration, date } = req.body;

  if (!description || typeof description !== 'string') {
    return res.status(400).json({ error: 'Description is required and should be a string' });
  }

  const numericDuration = Number(duration);
  if (!duration || isNaN(numericDuration) || numericDuration <= 0 || !Number.isInteger(numericDuration)) {
    return res.status(400).json({ error: 'Duration is required and should be an integer and  it should be positive values.' });
  }

  let exerciseDate = date ? date : new Date().toISOString().split('T')[0];
  if (!dateFormatValidation(exerciseDate)) {
    return res.status(400).json({ error: 'Date format should be in YYYY-MM-DD format' });
  }
  if (!dateValidation(exerciseDate)) {
    return res.status(400).json({ error: '' });
  }

  // Fetch the user from the database
  db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Log the result of the user lookup for debugging
    console.log('User found:', user);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Insert new exercise
    db.run(
      'INSERT INTO exercises (userId, description, duration, date) VALUES (?, ?, ?, ?)',
      [userId, description, numericDuration, exerciseDate],
      function (err) {
        if (err) {
          return res.status(500).json({ error: 'Error adding exercise. Please try again!' });
        }

        const newExercise = {
          id: this.lastID,
          userId: userId,
          description: description,
          duration: numericDuration,
          date: exerciseDate
        };

        res.status(201).json(newExercise);
      }
    );
  });
});

// GET /api/users/:_id/logs - Retrieve full exercise log for a specific user with filtering and limits
app.get('/api/users/:_id/logs', (req, res) => {
  const userId = parseInt(req.params._id);
  const { from, to, limit } = req.query;

  db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Query to calculate the total count
    let countQuery = 'SELECT COUNT(*) AS exerciseCount FROM exercises WHERE userId = ?';
    let logQuery = 'SELECT * FROM exercises WHERE userId = ?';
    const params = [userId];

    if (from) {
      if (dateValidation(from) && dateFormatValidation(from)) {
        countQuery += ' AND date >= ?';
        logQuery += ' AND date >= ?';
        params.push(from);
      } else {
        return res.status(400).json({ error: 'Invalid from date. Please enter YYYY-MM-DD date format.' });
      }
    }

    if (to) {
      if (dateValidation(to) && dateFormatValidation(to)) {
        countQuery += ' AND date <= ?';
        logQuery += ' AND date <= ?';
        params.push(to);
      } else {
        return res.status(400).json({ error: 'Invalid to date. Please enter YYYY-MM-DD date format.' });
      }
    }

    // Add sorting and limit to the log query
    logQuery += ' ORDER BY date';
    if (limit) {
      if (!isNaN(parseInt(limit))) {
        logQuery += ' LIMIT ?';
        params.push(parseInt(limit));
      } else {
        return res.status(400).json({ error: 'Invalid limit!' });
      }
    }

    // Execute the count query
    db.get(countQuery, params.slice(0, params.length - 1), (err, countResult) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const totalCount = countResult.exerciseCount;

      // Execute the log query
      db.all(logQuery, params, (err, exercises) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        const log = exercises.map(ex => ({
          id: ex.id,
          description: ex.description,
          duration: ex.duration,
          date: ex.date,
        }));

        // Construct the final response
        const response = {
          id: user.id,
          username: user.username,
          count: totalCount,
          log: log,
        };

        res.status(200).json(response);
      });
    });
  });
});


// Error handling for unsupported routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Start the server
const listener = app.listen(process.env.PORT || 3000, () => {
  console.log('Your app is listening on port ' + listener.address().port);
});

function dateValidation(date) {
  const parsedDate = new Date(date);
  const isValidDate = parsedDate instanceof Date && !isNaN(parsedDate.getTime()) && parsedDate.toISOString().split('T')[0] === date;
  if (!isValidDate) {
    return false;
  } else {
    return true;
  }
}

function dateFormatValidation(date) {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (date && !dateRegex.test(date)) {
    return false;
  } else {
    return true;
  }
}
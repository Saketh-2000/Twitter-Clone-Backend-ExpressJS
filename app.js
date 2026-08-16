const bcrypt = require('bcrypt')
const express = require('express')
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const jwt = require('jsonwebtoken')

const app = express()
app.use(express.json())

let db = null
const dbPath = path.join(__dirname, 'twitterClone.db')

const initializeDB = async () => {
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  })

  app.listen(3000, () => {
    console.log('Server started at http://localhost:3000')
  })
}

initializeDB()

// ✅ Middleware: Authenticate Token
const authenticateToken = (request, response, next) => {
  const authHeader = request.headers['authorization']
  let jwtToken

  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }

  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.userId = payload.userId
        next()
      }
    })
  }
}

// ✅ Register API
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body

  const getUserQuery = `SELECT * FROM user WHERE username = '${username}'`
  const user = await db.get(getUserQuery)

  if (user !== undefined) {
    response.status(400).send('User already exists')
  } else if (password.length <= 5) {
    response.status(400).send('Password is too short')
  } else {
    const hashedPassword = await bcrypt.hash(password, 10)
    const createUserQuery = `
      INSERT INTO user (name, username, password, gender)
      VALUES ('${name}', '${username}', '${hashedPassword}', '${gender}')
    `
    await db.run(createUserQuery)
    response.send('User created successfully')
  }
})

// ✅ Login API
app.post('/login/', async (request, response) => {
  const {username, password} = request.body

  const getUserQuery = `SELECT * FROM user WHERE username = '${username}'`
  const user = await db.get(getUserQuery)

  if (user === undefined) {
    response.status(400).send('Invalid user')
  } else {
    const isPasswordMatching = await bcrypt.compare(password, user.password)
    if (isPasswordMatching) {
      const payload = {username: user.username, userId: user.user_id}
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400).send('Invalid password')
    }
  }
})

module.exports = app

app.get('/user/tweets/feed', authenticateToken, async (request, response) => {
  const userId = request.userId

  const getTweetsQuery = `
    SELECT 
      user.username, tweet.tweet, tweet.date_time AS dateTime 
    FROM 
      follower 
      INNER JOIN tweet ON follower.following_user_id = tweet.user_id 
      INNER JOIN user ON tweet.user_id = user.user_id 
    WHERE 
      follower.follower_user_id = ${userId} 
    ORDER BY 
      tweet.date_time DESC 
    LIMIT 4;
  `

  const tweets = await db.all(getTweetsQuery)
  response.send(tweets)
})
app.get('/user/following/', authenticateToken, async (request, response) => {
  const userId = request.userId

  const getFollowingUsersQuery = `
    SELECT name
    FROM user
    INNER JOIN follower
    ON user.user_id = follower.following_user_id
    WHERE follower.follower_user_id = ${userId};
  `

  const followingUsers = await db.all(getFollowingUsersQuery)

  response.send(followingUsers)
})

app.get('/user/followers/', authenticateToken, async (request, response) => {
  try {
    const userId = request.userId
    // Step 1: Get the current user's ID from their username
    const getUserIdQuery = `SELECT user_id FROM user WHERE user_id = '${userId}'`
    const user = await db.get(getUserIdQuery)

    if (!user) {
      response.status(401).send('Invalid User')
      return
    }

    const getFollowersUserQuery = `
      SELECT name
    FROM user
    INNER JOIN follower ON user.user_id = follower.follower_user_id
    WHERE follower.following_user_id = ${userId};;
    `

    const followerUsersDbres = await db.all(getFollowersUserQuery)

    response.send(followerUsersDbres)
  } catch (error) {
    response.status(500).send('Server Error')
    console.log(error.message)
  }
})

app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const {tweetId} = request.params
  const userId = request.userId // Set in the JWT payload

  const getTweetQuery = `
    SELECT 
      tweet.tweet,
      tweet.date_time AS dateTime,
      COUNT(DISTINCT like.like_id) AS likes,
      COUNT(DISTINCT reply.reply_id) AS replies
    FROM 
      tweet
    INNER JOIN follower 
      ON tweet.user_id = follower.following_user_id
    LEFT JOIN like 
      ON tweet.tweet_id = like.tweet_id
    LEFT JOIN reply 
      ON tweet.tweet_id = reply.tweet_id
    WHERE 
      follower.follower_user_id = ${userId}
      AND tweet.tweet_id = ${tweetId}
    GROUP BY 
      tweet.tweet_id;
  `

  const dbResponse = await db.get(getTweetQuery)

  if (dbResponse) {
    response.send(dbResponse)
  } else {
    response.status(401).send('Invalid Request')
  }
})

app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const userId = request.userId

    const checkFollowQuery = `
      SELECT *
      FROM tweet
      INNER JOIN follower ON tweet.user_id = follower.following_user_id
      WHERE tweet.tweet_id = ${tweetId} AND follower.follower_user_id = ${userId};
    `
    const isAllowed = await db.get(checkFollowQuery)

    if (!isAllowed) {
      response.status(401).send('Invalid Request')
      return
    }

    const getLikesQuery = `
      SELECT user.username
      FROM like
      INNER JOIN user ON user.user_id = like.user_id
      WHERE like.tweet_id = ${tweetId};
    `
    const dbResponse = await db.all(getLikesQuery)
    const usernames = dbResponse.map(user => user.username)

    response.send({likes: usernames})
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const userId = request.userId

    const checkAccessQuery = `
    SELECT *
    FROM tweet
    INNER JOIN follower ON tweet.user_id = follower.following_user_id
    WHERE tweet.tweet_id = ${tweetId} AND follower.follower_user_id = ${userId};
  `
    const accessResult = await db.get(checkAccessQuery)

    if (!accessResult) {
      response.status(401).send('Invalid Request')
      return
    }

    const getRepliesQuery = `
    SELECT user.name AS name, reply.reply AS reply
    FROM reply
    INNER JOIN user ON reply.user_id = user.user_id
    WHERE reply.tweet_id = ${tweetId};
  `
    const replies = await db.all(getRepliesQuery)

    response.send({replies})
  },
)

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const userId = request.userId

  const getUserTweetsQuery = `
    SELECT 
      tweet.tweet AS tweet,
      COUNT(DISTINCT like.like_id) AS likes,
      COUNT(DISTINCT reply.reply_id) AS replies,
      tweet.date_time AS dateTime
    FROM tweet
    LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    WHERE tweet.user_id = ?
    GROUP BY tweet.tweet_id;
  `

  const tweets = await db.all(getUserTweetsQuery, [userId])

  response.send(tweets)
})

app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const userId = request.userId
  const {tweet} = request.body

  const dateTime = new Date().toISOString().replace('T', ' ').slice(0, 19)

  const createTweetQuery = `
    INSERT INTO tweet (tweet, user_id, date_time)
    VALUES ('${tweet}',${userId} , '${dateTime}');
  `

  await db.run(createTweetQuery)

  response.send('Created a Tweet')
})

app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const userId = request.userId

    const checkOwnershipQuery = `
    SELECT * FROM tweet
    WHERE tweet_id = ${tweetId} AND user_id = ${userId};
  `
    const tweet = await db.get(checkOwnershipQuery)

    if (!tweet) {
      response.status(401).send('Invalid Request')
      return
    }

    const deleteTweetQuery = `
    DELETE FROM tweet
    WHERE tweet_id = ${tweetId};
  `
    await db.run(deleteTweetQuery)

    response.send('Tweet Removed')
  },
)

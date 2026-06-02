import { pool } from '../config/database.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import {
  validateEmail,
  validateLoginPassword,
  validatePassword,
  validateUsername,
  sendValidationError,
} from '../utils/validation.js'

const TOKEN_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000

function tokenCookieOptions() {
    const isProd = process.env.NODE_ENV === 'production'
    return {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'lax' : 'strict',
        maxAge: TOKEN_COOKIE_MAX_AGE,
        path: '/',
    }
}

export const loginUser = async (req, res) => {
    const emailResult = validateEmail(req.body?.email)
    if (!emailResult.ok) {
        return sendValidationError(res, emailResult.error)
    }
    const passwordResult = validateLoginPassword(req.body?.password)
    if (!passwordResult.ok) {
        return sendValidationError(res, passwordResult.error)
    }

    const { value: email } = emailResult
    const { value: password } = passwordResult

    const query = 'SELECT * FROM users WHERE email = $1'
    const values = [email]
    const result = await pool.query(query, values)
    const user = result.rows[0]
    if (!user) {
        res.status(401).json({message: 'Invalid email or password'})
        return
    }
    const isPasswordValid = await bcrypt.compare(password, user.hashed_password)
    if (!isPasswordValid) {
        res.status(401).json({message: 'Invalid email or password'})
        return
    }

    const token = jwt.sign(
        {
            id: user.id,
            email: user.email
        },
        process.env.JWT_SECRET,
        {
            expiresIn: '1h'
        }
    )
    res.cookie('token', token, tokenCookieOptions())
    res.status(200).json({message: 'Login successful'})
}
export const signUpUser = async (req, res) => {
    const usernameResult = validateUsername(req.body?.username)
    if (!usernameResult.ok) {
        return sendValidationError(res, usernameResult.error)
    }
    const emailResult = validateEmail(req.body?.email)
    if (!emailResult.ok) {
        return sendValidationError(res, emailResult.error)
    }
    const passwordResult = validatePassword(req.body?.password)
    if (!passwordResult.ok) {
        return sendValidationError(res, passwordResult.error)
    }

    const username = usernameResult.value
    const email = emailResult.value
    const password = passwordResult.value

    const result = await pool.query('SELECT id FROM users WHERE email = $1', [email])
    if (result.rows[0]) {
        res.status(409).json({ message: 'User already exists' })
        return
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    try {
        const insertResult = await pool.query(
            'INSERT INTO users (username, email, hashed_password) VALUES ($1, $2, $3) RETURNING id, username, email',
            [username, email, hashedPassword]
        )
        const newUser = insertResult.rows[0]
        res.status(201).json({ message: 'User created successfully', user: newUser })
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'User already exists' })
        }
        console.error('Signup error:', err)
        return res.status(500).json({ message: 'Unable to create account' })
    }
}

export const logoutUser = async (req, res) => {
    res.clearCookie('token', tokenCookieOptions())
    res.status(200).json({message: 'Logout successful'})
}

export const getCurrentUser = async (req, res) => {
    try {
        const token = req.cookies.token
        if (!token) {
            return res.status(401).json({
                message: 'Unauthorized'
            })
        }
        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        )
        const result = await pool.query(
            'SELECT id, username, email FROM users WHERE id = $1',
            [decoded.id]
        )
        const user = result.rows[0]
        if (!user) {
            return res.status(404).json({
                message: "User not found"
            })
        }
        res.status(200).json({
            success: true,
            user
        })
    } catch (err) {
        console.error(err)
        res.status(401).json({
            message: 'Invalid token'
        })
    }
}

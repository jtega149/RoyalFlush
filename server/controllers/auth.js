import { pool } from '../config/database.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

export const loginUser = async (req, res) => {
    const {email, password} = req.body
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
    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
    })
    res.status(200).json({message: 'Login successful'})
}
export const signUpUser = async (req, res) => {
    const {username, email, password} = req.body
    if (!username || !email || !password) {
        res.status(400).json({message: 'All fields are required'})
        return
    }
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email])
    const user = result.rows[0]
    if (user) {
        res.status(409).json({message: 'User already exists'})
        return
    }
    const hashedPassword = await bcrypt.hash(password, 10)
    const insert_result = await pool.query('INSERT INTO users (username, email, hashed_password) VALUES ($1, $2, $3) RETURNING *', [username, email, hashedPassword])
    const newUser = insert_result.rows[0]
    res.status(201).json({message: 'User created successfully', user: newUser})
}

export const logoutUser = async (req, res) => {
    res.clearCookie('token')
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
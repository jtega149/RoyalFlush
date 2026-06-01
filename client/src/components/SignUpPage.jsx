import React, { useState } from 'react'
import { authApi, getErrorMessage } from '../api'
import { Link } from 'react-router-dom'
import '../styles/LoginPage.css'

const SignUpPage = () => {
    const [user, setUser] = useState({
        username: '',
        email: '',
        password: '',
        confirmPassword: ''
    })

    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    const handleChange = (e) => {
        setUser({
            ...user,
            [e.target.name]: e.target.value
        })
    }

    const handleSignup = async (e) => {
        e.preventDefault()

        if (
            !user.username ||
            !user.email ||
            !user.password ||
            !user.confirmPassword
        ) {
            setError('Please fill in all fields')
            return
        }

        if (user.password !== user.confirmPassword) {
            setError('Passwords do not match')
            return
        }

        if (user.password.length < 6) {
            setError('Password must be at least 6 characters')
            return
        }

        try {
            setLoading(true)
            setError('')

            await authApi.signup(
                user.username,
                user.email,
                user.password
            )

            // Optional: automatically log in afterward
            await authApi.login(
                user.email,
                user.password
            )

            window.location.href = '/'

        } catch (err) {
            console.error(err)

            setError(getErrorMessage(err, 'Unable to create account'))

        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="login-container">
            <div className="login-card">
                <h1 className="login-title">
                    Royal Flush
                </h1>

                <p className="login-subtitle">
                    Create your account
                </p>

                <form
                    className="login-form"
                    onSubmit={handleSignup}
                >
                    <input
                        className="login-input"
                        type="text"
                        name="username"
                        placeholder="Username"
                        value={user.username}
                        onChange={handleChange}
                    />

                    <input
                        className="login-input"
                        type="email"
                        name="email"
                        placeholder="Email"
                        value={user.email}
                        onChange={handleChange}
                    />

                    <input
                        className="login-input"
                        type="password"
                        name="password"
                        placeholder="Password"
                        value={user.password}
                        onChange={handleChange}
                    />

                    <input
                        className="login-input"
                        type="password"
                        name="confirmPassword"
                        placeholder="Confirm Password"
                        value={user.confirmPassword}
                        onChange={handleChange}
                    />

                    <button
                        className="login-button"
                        type="submit"
                        disabled={loading}
                    >
                        {loading
                            ? 'Creating Account...'
                            : 'Sign Up'}
                    </button>
                </form>

                {error && (
                    <p className="login-error">
                        {error}
                    </p>
                )}

                <div className="login-footer">
                    Already have an account?{' '}
                    <Link to="/login">
                        Log In
                    </Link>
                    <br/>
                    Or continue as a guest: <a href="/">Home</a>
                </div>
            </div>
        </div>
    )
}

export default SignUpPage
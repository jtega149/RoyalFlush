import React, {useState, useEffect} from 'react'
import { authApi } from '../api'
import '../styles/LoginPage.css'

const LoginPage = () => {
    const [user, setUser] = useState({email: '', password: ''})
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    const handleChange = async (e) => {
        setUser({
            ...user,
            [e.target.name]: e.target.value
        })
    }

    const handleLogin = async (e) => {
        e.preventDefault()

        if (!user.email || !user.password) {
            setError("Enter email or password")
            return
        }
        try {
            setLoading(true)
            setError('')
            const data = await authApi.login(user.email, user.password)
            window.location.href = '/'
        } catch (err) {
            console.error(err)
            setError(err.message || 'Server Error')
        } finally {
            setLoading(false)
        }
    }
  return (
    <div className="login-container">
        <div className="login-card">
            <h1 className="login-title">Royal Flush</h1>
            <p className="login-subtitle">
                Log in to access reviews and bookmarks
            </p>

            <form className="login-form" onSubmit={handleLogin}>
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

                <button
                    className="login-button"
                    type="submit"
                    disabled={loading}
                >
                    {loading ? 'Logging in...' : 'Login'}
                </button>
            </form>

            {error && (
                <p className="login-error">
                    {error}
                </p>
            )}

            <div className="login-footer">
                Don’t have an account? <a href="/signup">Sign Up</a>
                <br/>
                Or continue as a guest: <a href="/">Home</a>
            </div>
        </div>
    </div>
    )
}

export default LoginPage
import { describe, test, expect } from 'vitest'
import { validateEmail, parseRating, validateUsername, validatePassword, validateLoginPassword, validateLatitude, validateLongitude } from '../utils/validation.js'

describe('Validation of sanitization functions', () => {
    describe('Validating sanitization of user credentials', () => {
        test("Testing invalid email addresses", () => {
            const email = "    john.doe.example.com   "
            const result = validateEmail(email)
            expect(result.ok).toBe(false)
            expect(result.error).toBe('Invalid email address')
        })
        test("Testing valid email addresses", () => {
            const email = "johnDeO1334@gmail.com"
            const result = validateEmail(email)
            expect(result.ok).toBe(true)
            expect(result.value).toBe('johndeo1334@gmail.com')
        })
        test("Testing invalid rating values", () => {
            const rating = "3.5.1"
            const result = parseRating(rating)
            expect(result.error).toBe('Invalid rating value')
        })
        test("Testing valid rating values", ()=> {
            const rating = "3.5"
            const result = parseRating(rating)
            expect(result.ok).toBe(true)
            expect(result.value).toBe(3.5)
        })
        test("Testing non 0.5 step rating values", () => {
            const rating = "3.3"
            const result = parseRating(rating)
            expect(result.ok).toBe(false)
            expect(result.error).toBe('Rating must be in 0.5 increments')
        })
        test("Testing invalid username values", () => {
            const username = "john doe example@gmail.com"
            const result = validateUsername(username)
            expect(result.ok).toBe(false)
            expect(result.error).toBe('Username contains invalid characters')
        })
        test("Testing valid username values", () => {
            const username = "johnDeO1334"
            const result = validateUsername(username)
            expect(result.ok).toBe(true)
            expect(result.value).toBe('johnDeO1334')
        })
        test("Testing invalid password values", () => {
            const password = "1234"
            const result = validatePassword(password)
            expect(result.ok).toBe(false)
            expect(result.error).toBe('Password must be at least 6 characters')
        })
        test("Testing valid password values", () => {
            const password = "1234567890"
            const result = validatePassword(password)
            expect(result.ok).toBe(true)
            expect(result.value).toBe('1234567890')
        })
        test("Testing invalid login password values", () => {
            const password = "1234567890123456789123456789123456789123456789123456789123456789123456789123456789123456789123456789123456789123456789123456789123456789123456789123456789123456789123456789"
            const result = validateLoginPassword(password)
            expect(result.ok).toBe(false)
            expect(result.error).toBe('Password must be at most 128 characters')
        })
        test("Testing valid login password values", () => {
            const password = "1234567890"
            const result = validateLoginPassword(password)
            expect(result.ok).toBe(true)
            expect(result.value).toBe('1234567890')
        })
        test("Testing invalid latitude values", () => {
            const latitude = "91"
            const result = validateLatitude(latitude)
            expect(result.ok).toBe(false)
            expect(result.error).toBe('Invalid latitude')
        })
        test("Testing valid latitude values", () => {
            const latitude = "40.7128"
            const result = validateLatitude(latitude)
            expect(result.ok).toBe(true)
            expect(result.value).toBe(40.7128)
        })
        test("Testing invalid longitude values", () => {
            const longitude = "181"
            const result = validateLongitude(longitude)
            expect(result.ok).toBe(false)
            expect(result.error).toBe('Invalid longitude')
        })
        test("Testing valid longitude values", () => {
            const longitude = "-122.4194"
            const result = validateLongitude(longitude)
            expect(result.ok).toBe(true)
            expect(result.value).toBe(-122.4194)
        })
    })
})
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// MiniMax API 配置
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_BASE_URL = 'https://api.minimax.io/anthropic';

// 簡單的內存存儲 (生產環境應該用數據庫)
const users = new Map();
const requests = new Map();

// 中間件：驗證 API Key
const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
        return res.status(401).json({ error: 'API key required' });
    }
    
    // 簡單驗證 (生產環境要更嚴謹)
    if (!users.has(apiKey)) {
        return res.status(401).json({ error: 'Invalid API key' });
    }
    
    req.user = users.get(apiKey);
    next();
};

// 計數器：中頻控制
const checkRateLimit = (user) => {
    const now = Date.now();
    const today = new Date().toDateString();
    
    if (user.lastDate !== today) {
        user.requests = 0;
        user.lastDate = today;
    }
    
    if (user.plan === 'free' && user.requests >= 50) {
        return false;
    }
    
    user.requests++;
    return true;
};

// 生成回覆
async function generateResponse(prompt, systemPrompt = '') {
    try {
        const response = await axios.post(
            `${MINIMAX_BASE_URL}/messages`,
            {
                model: 'MiniMax-M2.1',
                max_tokens: 2048,
                messages: [
                    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                    { role: 'user', content: prompt }
                ]
            },
            {
                headers: {
                    'Authorization': `Bearer ${MINIMAX_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        return response.data.content[0].text;
    } catch (error) {
        console.error('MiniMax API error:', error.response?.data || error.message);
        throw new Error('AI 生成失敗，請稍後再試');
    }
}

// ============ API Routes ============

// 1. 註冊/登錄
app.post('/api/auth/register', (req, res) => {
    const { email, plan = 'free' } = req.body;
    
    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }
    
    // 生成簡單的 API key (生產環境要更安全)
    const apiKey = `ak_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    users.set(apiKey, {
        email,
        plan,
        requests: 0,
        createdAt: new Date()
    });
    
    res.json({
        success: true,
        apiKey,
        plan,
        limits: plan === 'free' ? { monthly: 50 } : { unlimited: true }
    });
});

// 2. 聊天接口
app.post('/api/chat', authenticate, async (req, res) => {
    if (!checkRateLimit(req.user)) {
        return res.status(429).json({ 
            error: 'Rate limit exceeded',
            message: '免費計劃每月限 50 次，請升級 Pro'
        });
    }
    
    const { message, systemPrompt, context } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message required' });
    }
    
    try {
        const fullPrompt = context 
            ? `Context: ${context}\n\nUser: ${message}`
            : message;
        
        const result = await generateResponse(fullPrompt, systemPrompt);
        
        res.json({
            success: true,
            response: result,
            usage: {
                requests: req.user.requests,
                remaining: req.user.plan === 'free' ? 50 - req.user.requests : 'unlimited'
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. 郵件生成
app.post('/api/email', authenticate, async (req, res) => {
    if (!checkRateLimit(req.user)) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    
    const { type, recipient, topic, tone = 'professional' } = req.body;
    
    const prompts = {
        cold: `Write a cold email to ${recipient} about ${topic}. Tone: ${tone}. Include subject line.`,
        followup: `Write a follow-up email about ${topic} to ${recipient}. Tone: ${tone}.`,
        response: `Write a response email to ${recipient} about ${topic}. Tone: ${tone}.`
    };
    
    const prompt = prompts[type] || prompts.cold;
    
    try {
        const result = await generateResponse(prompt, 'You are a professional email writer.');
        
        res.json({
            success: true,
            email: result
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. 內容生成
app.post('/api/content', authenticate, async (req, res) => {
    if (!checkRateLimit(req.user)) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    
    const { type, topic, words = 500, style = 'informative' } = req.body;
    
    const prompts = {
        blog: `Write a ${words}-word blog post about ${topic}. Style: ${style}.`,
        social: `Write a social media post about ${topic}. Engaging and concise.`,
        product: `Write a product description for ${topic}. ${words} words. Persuasive style.`
    };
    
    const prompt = prompts[type] || prompts.blog;
    
    try {
        const result = await generateResponse(prompt, 'You are a professional content writer.');
        
        res.json({
            success: true,
            content: result
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. 分析接口
app.post('/api/analyze', authenticate, async (req, res) => {
    if (!checkRateLimit(req.user)) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    
    const { type, data } = req.body;
    
    const prompts = {
        swot: `Perform SWOT analysis for: ${data}`,
        summary: `Summarize this: ${data}`,
        sentiment: `Analyze sentiment of: ${data}`
    };
    
    const prompt = prompts[type] || prompts.summary;
    
    try {
        const result = await generateResponse(prompt, 'You are a business analyst.');
        
        res.json({
            success: true,
            analysis: result
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 6. 用戶信息
app.get('/api/user', authenticate, (req, res) => {
    res.json({
        email: req.user.email,
        plan: req.user.plan,
        requests: req.user.requests,
        createdAt: req.user.createdAt
    });
});

// 健康檢查
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🤖 AI Agent Tool running on port ${PORT}`);
});

module.exports = app;

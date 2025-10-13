/**
 * Microservicio Node.js para Andreani PyMés
 * Versión SIMPLIFICADA - Token manual
 */

const express = require('express');
const { HubConnectionBuilder, HttpTransportType } = require('@microsoft/signalr');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// Cache simple de token (un solo usuario por ahora)
let tokenCache = {
    access_token: null,
    expires_at: null,
    username: null
};

/**
 * Cotiza envío usando SignalR
 */
async function cotizarEnvio(accessToken, params) {
    console.log('🔑 Token recibido (primeros 50 chars):', accessToken.substring(0, 50));
    console.log('📏 Longitud del token:', accessToken.length);
    
    const hubUrl = `https://pymes-api.andreani.com/hubCotizacion?access_token=${accessToken}`;
    
    console.log('🔗 Conectando a SignalR...');
    console.log('📦 Params:', JSON.stringify(params, null, 2));
    
    const connection = new HubConnectionBuilder()
        .withUrl(hubUrl, {
            skipNegotiation: false, // Cambiar a false para negociar
            transport: HttpTransportType.WebSockets
        })
        .withAutomaticReconnect()
        .build();
    
    try {
        console.log('🔌 Intentando conectar al WebSocket...');
        await connection.start();
        console.log('✅ Conectado al WebSocket exitosamente');
        
        const cotizacionData = {
            usuarioId: params.usuarioId || '',
            tipoDeEnvioId: params.tipoDeEnvioId,
            sucursalOrigen: params.sucursalOrigen,
            codigoPostalDestino: params.codigoPostalDestino,
            bultos: params.bultos
        };
        
        if (params.destinatario) {
            cotizacionData.destinatario = params.destinatario;
        }
        
        console.log('📤 Invocando método Cotizar con:', JSON.stringify(cotizacionData, null, 2));
        
        const result = await connection.invoke('Cotizar', cotizacionData);
        
        console.log('📥 Respuesta recibida:', JSON.stringify(result, null, 2));
        
        await connection.stop();
        return result;
        
    } catch (error) {
        console.error('❌ Error detallado:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        
        try {
            await connection.stop();
        } catch (e) {
            // Ignorar error al cerrar
        }
        
        throw error;
    }
}

// ============================================
// ENDPOINTS
// ============================================

/**
 * POST /set-token
 * Guarda el token en cache
 */
app.post('/set-token', (req, res) => {
    try {
        const { username, access_token, expires_in } = req.body;
        
        if (!access_token) {
            return res.status(400).json({ 
                success: false,
                error: 'access_token requerido' 
            });
        }
        
        tokenCache = {
            access_token: access_token,
            expires_at: Date.now() + ((expires_in || 5400) * 1000),
            username: username
        };
        
        console.log('💾 Token guardado en cache');
        
        res.json({
            success: true,
            message: 'Token guardado correctamente',
            expires_in: expires_in || 5400
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /cotizar
 * Cotiza un envío
 */
app.post('/cotizar', async (req, res) => {
    try {
        const { token, params } = req.body;
        
        if (!params) {
            return res.status(400).json({ 
                success: false,
                error: 'Parámetros de cotización requeridos' 
            });
        }
        
        // Usar token del request o del cache
        let accessToken = token || tokenCache.access_token;
        
        if (!accessToken) {
            return res.status(401).json({
                success: false,
                error: 'TOKEN_REQUIRED',
                message: 'No hay token disponible. Enviá el token en el request.'
            });
        }
        
        // Verificar si está expirado (solo si es del cache)
        if (!token && tokenCache.expires_at && tokenCache.expires_at < Date.now()) {
            console.log('⚠️ Token en cache expirado');
            return res.status(401).json({
                success: false,
                error: 'TOKEN_EXPIRED',
                message: 'El token en cache expiró. Enviá un token fresco.'
            });
        }
        
        console.log('✅ Token disponible, cotizando...');
        
        // Si vino un token nuevo en el request, guardarlo
        if (token) {
            tokenCache.access_token = token;
            tokenCache.expires_at = Date.now() + (5400 * 1000);
        }
        
        // Cotizar
        const result = await cotizarEnvio(accessToken, params);
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        console.error('❌ Error en cotización:', error.message);
        
        // Si es error de autenticación, limpiar cache
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
            tokenCache = { access_token: null, expires_at: null, username: null };
            return res.status(401).json({
                success: false,
                error: 'TOKEN_INVALID',
                message: 'Token inválido o expirado'
            });
        }
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /health
 */
app.get('/health', (req, res) => {
    const hasToken = !!tokenCache.access_token;
    const isExpired = tokenCache.expires_at ? tokenCache.expires_at < Date.now() : true;
    
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        token_cached: hasToken,
        token_expired: isExpired,
        token_expires_in: tokenCache.expires_at ? Math.floor((tokenCache.expires_at - Date.now()) / 1000) : 0
    });
});

// Ruta raíz
app.get('/', (req, res) => {
    res.json({
        service: 'Andreani Service API',
        version: '2.0.0 - Simplified',
        endpoints: {
            health: 'GET /health',
            set_token: 'POST /set-token',
            cotizar: 'POST /cotizar'
        },
        status: 'running'
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🚀 Andreani Service RUNNING         ║
║   📡 Port: ${PORT}                       ║
║   ✅ Sin Puppeteer - 100% estable     ║
╚═══════════════════════════════════════╝
    `);
});
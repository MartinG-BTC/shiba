// TODO: are force-ended games handled correctly?

const EventEmitter = require("events")
const PowerClient = require("power-client")


const debug     = require("debug")("shiba:client")
const debugchat = require("debug")("shiba:chat")
const debuggame = require("debug")("shiba:game")
const debugtick = require("debug")("verbose:tick")


module.exports = class BustabitClient extends EventEmitter {
    constructor(config) {
        super()

        this.config = config
        this.clearState()

        debug("Setting up connection to %s", config.API_SERVER)
        this.socket = new PowerClient(config.API_SERVER, config.API_KEY, config.SESSION)

        this.socket.on("connected", this.handleConnected.bind(this))
        this.socket.on("disconnected", this.handleDisconnected.bind(this))
        this.socket.on("error", error => console.error("onError", error))

        this.socket.on("gameStarting", this.handleGameStarting.bind(this))
        this.socket.on("betPlaced", this.handleBetPlaced.bind(this))
        this.socket.on("gameStarted", this.handleGameStarted.bind(this))
        this.socket.on("cashedOut", this.handleGameTick.bind(this))
        this.socket.on("gameEnded", this.handleGameEnded.bind(this))
    }

    /**
     * Attempt to mute a user and return whether he actually was. Users are not muted if they are on
     * the USER_WHITELIST in Config.js.
     * @param {string} uname
     * @param {string} [reason]
     * @param {string} [channel] chat channel to which the broadcast the mute
     * @param {number} [wagerRequirement] required wager volume before user can chat again, otherwise allowing the server to choose
     * @returns {Promise<boolean>} true if the user was muted
     */
    async doMute(uname, reason, channel, wagerRequirement = -1) {
        if (this.config.USER_WHITELIST.includes(uname.toLowerCase())) {
            debugchat("Not muting whitelisted user: %s amount: %s", uname, wagerRequirement)
            return false
        }

        debugchat("Muting user: %s amount: %s", uname, wagerRequirement)
        wagerRequirement = wagerRequirement || -1
        try {
            await this.socket.send("mute", { uname, reason, channel, wagerRequirement })
        } catch (error) {
            console.error("[BustabitClient.doMute]", error)
        }
        return true
    }

    /**
     * Send a public chat message to the given channel.
     * @param {string} message
     * @param {string} channel
     */
    async doSay(message, channel) {
        debugchat("Saying:", message)
        try {
            await this.socket.send("say", { channel, message })
        } catch (error) {
            console.error("[BustabitClient.doSay]", error)
        }
    }

    /**
     * Fetch a game's information and reshape it into what Pg.putGame expects.
     * @param {number} id game ID
     * @returns {Promise}
     */
    async getGameInfo(id) {
        const game = await this.socket.send("getGameInfo", id)
        game.created = new Date(game.created).getTime()
        game.startTime = game.created + 5000
        game.serverSeed = game.hash
        game.playing = {}
        game.cashedOut = []
        for (const { uname, wager, cashOut } of game.bets) {
            if (!cashOut) {
                game.playing[uname] = { wager }
            } else {
                game.cashedOut.push({ uname, wager, cashedAt: cashOut })
            }
        }
        return game
    }


    // event handlers

    handleConnected(data) {
        const { engineInfo, loggedIn } = data
        if (!loggedIn) {
            throw new Error("invalid session ID")
        }
        this.username = loggedIn.userInfo.uname
        debug("connected to server as", this.username)

        // TODO: game server sends incorrect/incomplete information for games that were forcibly ended

        // save current game state
        this.game = {
            id:        engineInfo.gameId,
            state:     engineInfo.gameState,
            created:   Date.now() - engineInfo.elapsed - 5000,
            startTime: Date.now() - engineInfo.elapsed,
            playing:   engineInfo.playing,
            cashedOut: engineInfo.cashedOut || [],
        }

        this.emit("connected", data)
    }

    handleDisconnected(reconnectIn) {
        debug(`disconnected from server. attempting to reconnect in ${reconnectIn/1000}s`)
        this.clearState()
    }

    handleGameStarting({ gameId }) {
        debuggame(`Game #${gameId} starting`)
        this.game = {
            id:        gameId,
            state:     "GAME_STARTING",
            created:   Date.now(),
            startTime: Date.now() + 5000,
            playing:   {},
            cashedOut: [],
        }
        this.emit("gameStarting")
    }

    handleBetPlaced({ uname, wager, payout }) {
        debuggame(`Player ${uname} wagered ${wager} @ ${payout.toFixed(2)}`)
        this.game.playing[uname] = { wager, payout }
    }

    handleGameStarted() {
        debuggame(`Game #${this.game.id} started`)
        this.game.state = "GAME_STARTED"
        this.emit("gameStarted")
    }

    handleGameTick([ multiplier, cashOuts ]) {
        debugtick(`Game #${this.game.id} ticked`, { multiplier, cashOuts: cashOuts.length })

        // players that were cashed out automatically
        for (const uname of Object.keys(this.game.playing)) {
            const { wager, payout } = this.game.playing[uname]
            if (multiplier >= payout) {
                this.game.cashedOut.push({ uname, wager, cashedAt: payout })
                delete this.game.playing[uname]
                debuggame(`Player ${uname} was automatically cashed out at ${payout.toFixed(2)}`)
            }
        }

        // players that cashed out manually
        for (const [ cashedAt, uname ] of cashOuts) {
            console.assert(this.game.playing[uname])
            const { wager } = this.game.playing[uname]
            this.game.cashedOut.push({ uname, wager, cashedAt })
            delete this.game.playing[uname]
            debuggame(`Player ${uname} manually cashed out at ${cashedAt.toFixed(2)}`)
        }

        this.emit("cashedOut")
    }
    handleGameEnded({ bust, forced, hash }) {
        debuggame(`Game #${this.game.id} crashed @${bust}`)
        this.game.state = "GAME_ENDED"
        this.game.bust = bust
        this.game.forced = forced
        this.game.serverSeed = hash

        if (forced) {
            for (const uname of Object.keys(this.game.playing)) {
                const { wager } = this.game.playing[uname]
                this.game.cashedOut.push({ uname, wager, cashedAt: forced })
                delete this.game.playing[uname]
                debuggame(`Player ${uname} was forced to cash out at ${forced.toFixed(2)}`)
            }
        }

        this.emit("gameEnded", this.game)
    }

    /** Reset the user and game state to its zero values. */
    clearState() {
        this.username = null
        this.game = null
    }
}

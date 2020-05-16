import { HapiPlugin, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import { ConfigService } from '../services/config';
import * as _get from 'lodash.get';
import { bind } from '../utils';

export class ErrorRedirectPlugin implements HapiPlugin {
    @inject('$server')
    private server: Server;

    @inject('config')
    private config: ConfigService;

    // @ts-ignore (options)
    public async register(server: Server, options: any) {
        this.server.log(['ErrorRedirectPlugin', 'info'], 'register');

        try {
            server.ext('onPreResponse', this.preResponse);
        }
        catch (ex) {
            this.server.log(['ErrorRedirectPlugin', 'error'], `Error while registering input adapters: ${ex.message}`);
        }
    }

    @bind
    private async preResponse(request, h) {
        if (_get(request, 'response.output.statusCode') === 500
            && _get(request, 'url.pathname') === this.config.get('authAmsSigninRedirectUrl')) {
            return h.redirect('/user');
        }

        return h.continue;
    }
}

import { ErrorHandler, Injectable, Injector } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseAdminService } from '../auth/supabase-admin.service';

@Injectable()
export class CozyErrorHandler implements ErrorHandler {
  constructor(private readonly injector: Injector) {}

  handleError(error: unknown): void {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? '' : '';
    try {
      const connection = this.injector.get(SupabaseAdminService);
      const router = this.injector.get(Router);
      void connection.client.rpc('report_client_error', {
        p_message: message,
        p_stack: stack,
        p_path: router.url || '/',
        p_context: 'cozycraft-admin-mobile',
        p_user_agent: navigator.userAgent,
      });
    } catch {
      // Never let telemetry handling replace the original application error.
    }
  }
}

// Authentication state through TanStack Query, as in RecruiterOS: the current
// user is a query ("who am I?"); login and logout update that query's cache.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { AuthUser } from '@/types/auth'

export const authUserQueryKey = ['auth', 'me'] as const

export function useAuth() {
  const queryClient = useQueryClient()

  const { data: user, isLoading } = useQuery({
    queryKey: authUserQueryKey,
    // 401 means "signed out", not an error.
    queryFn: () =>
      api<AuthUser>('/api/auth/me').catch((error) => {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }),
    retry: false,
  })

  const login = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      api<AuthUser>('/api/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
    onSuccess: (signedIn) => queryClient.setQueryData(authUserQueryKey, signedIn),
  })

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' })
    queryClient.clear() // drop every cached query of the previous user
    queryClient.setQueryData(authUserQueryKey, null)
  }

  return { user, isLoading, login, logout }
}

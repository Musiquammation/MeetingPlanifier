# API `Database`

Classe TypeScript d’accès aux données SQLite. Elle initialise le schéma, applique les contraintes relationnelles et expose les opérations de gestion des entreprises, utilisateurs, créneaux, salles et réunions.

Les types d’entrée et de sortie (`Company`, `Agent`, `Meeting`, etc.) sont définis dans `Database.ts`. Les méthodes de recherche renvoient généralement `null` si l’élément est absent ; les opérations invalides peuvent lever une `Error` ou une erreur SQLite.

## Méthodes publiques

### Initialisation et transactions

- **`initialize(): void`** — Crée les tables, index et triggers manquants sans supprimer les données existantes.
- **`withTransaction(callback: () => T): T`** — Exécute un callback dans une transaction atomique, avec savepoints imbriqués.
- **`healthCheck(): { ok: true; sqliteVersion: string; databasePath: string }`** — Retourne l’état de la base, la version SQLite et le chemin utilisé.
- **`close(): void`** — Ferme la connexion SQLite si elle est encore ouverte.

### Entreprises et administrateurs

- **`createCompany(name: string): Company`** — Crée une entreprise.
- **`createAdminWithCompany(input: { username: string; passwordHash: string; displayName: string; companyName: string; level?: number; }): { admin: Admin; company: Company; privilege: Privilege }`** — Crée une entreprise, un administrateur et son privilège dans une transaction.
- **`getCompanyById(id: number): Company | null`** — Recherche une entreprise par identifiant.
- **`getCompanyByName(name: string): Company | null`** — Recherche une entreprise par nom, sans distinction de casse.
- **`listCompanies(): Company[]`** — Liste les entreprises par nom.
- **`updateCompanyName(id: number, name: string): Company`** — Renomme une entreprise.
- **`getAdminById(id: number): Admin | null`** — Recherche un administrateur sans exposer son hash de mot de passe.
- **`getAdminCredentialsByUsername(username: string): AdminCredentials | null`** — Recherche un administrateur par identifiant et retourne ses informations d’authentification.
- **`getPrivilegeByAdminId(adminId: number): Privilege | null`** — Retourne le privilège associé à un administrateur.
- **`getCompanyForAdmin(adminId: number): Company | null`** — Retourne l’entreprise associée à un administrateur.
- **`updatePrivilegeLevel(adminId: number, level: number): Privilege`** — Modifie le niveau de privilège d’un administrateur.

### Agents et contrats

- **`createAgent(input: CreateAgentInput): Agent`** — Crée un agent.
- **`getAgentById(id: number): Agent | null`** — Recherche un agent par identifiant.
- **`getAgentCredentialsByUsername(username: string): AgentCredentials | null`** — Recherche un agent par nom d’utilisateur avec ses informations d’authentification.
- **`listAgentsForCompany(companyId: number): Agent[]`** — Liste les agents liés à une entreprise par contrat.
- **`updateAgentProfile(id: number, input: { name: string; surname: string; username: string }): Agent`** — Met à jour le nom, le prénom et le nom d’utilisateur d’un agent.
- **`setAgentPasswordHash(id: number, passwordHash: string | null): void`** — Modifie le hash du mot de passe d’un agent.
- **`setAgentStatus(id: number, status: AgentStatus): Agent`** — Modifie le statut d’un agent.
- **`createContract(agentId: number, companyId: number): Contract`** — Associe un agent à une entreprise.
- **`getContractById(id: number): Contract | null`** — Recherche un contrat par identifiant.
- **`listContractsForAgent(agentId: number): Contract[]`** — Liste les contrats d’un agent.
- **`listContractsForCompany(companyId: number): Contract[]`** — Liste les contrats d’une entreprise.
- **`deleteContract(contractId: number): void`** — Supprime un contrat, sous réserve des contraintes référentielles.

### Consommateurs, fidélités et assignations

- **`createConsumer(input: CreateConsumerInput): Consumer`** — Crée un consommateur et génère sa clé personnelle.
- **`getConsumerById(id: number): Consumer | null`** — Recherche un consommateur sans données d’authentification.
- **`getConsumerCredentialsByUsername(username: string): ConsumerCredentials | null`** — Recherche un consommateur par nom d’utilisateur avec ses informations d’authentification.
- **`getConsumerCredentialsById(id: number): ConsumerCredentials | null`** — Recherche les informations d’authentification d’un consommateur par identifiant.
- **`getConsumerByPersonalKey(key: string): ConsumerCredentials | null`** — Recherche un consommateur par clé personnelle.
- **`searchConsumers(query: string, limit = 20): Array<Pick<Consumer, "id" | "name" | "surname" | "username">>`** — Recherche des consommateurs par nom, prénom ou nom d’utilisateur, avec limite de résultats.
- **`listConsumersForCompany(companyId: number): Array<{ consumer: Pick<Consumer, "id" | "name" | "surname" | "username">; fidelity: Fidelity; }>`** — Liste les consommateurs d’une entreprise avec leur fidélité.
- **`updateConsumerProfile(id: number, input: { name: string; surname: string; username: string }): Consumer`** — Met à jour le profil d’un consommateur.
- **`setConsumerPasswordHash(id: number, passwordHash: string | null): void`** — Modifie le hash du mot de passe d’un consommateur.
- **`createFidelity(companyId: number, consumerId: number): Fidelity`** — Crée une fidélité entre une entreprise et un consommateur.
- **`getFidelityById(id: number): Fidelity | null`** — Recherche une fidélité par identifiant.
- **`getFidelityByAccessKey(key: string): Fidelity | null`** — Recherche une fidélité active par clé d’accès.
- **`listFidelitiesForCompany(companyId: number): Fidelity[]`** — Liste les fidélités d’une entreprise.
- **`setFidelityActive(id: number, active: boolean): Fidelity`** — Active ou désactive une fidélité.
- **`createAssignation(agentId: number, fidelityId: number): Assignation`** — Assigne un agent à une fidélité.
- **`getAssignationById(id: number): Assignation | null`** — Recherche une assignation par identifiant.
- **`listAssignationsForAgent(agentId: number): Assignation[]`** — Liste les assignations d’un agent.
- **`listAssignationsForConsumer(consumerId: number): Assignation[]`** — Liste les assignations actives d’un consommateur.
- **`listAssignedAgentsForConsumer(consumerId: number): Array<{ assignationId: number; agent: Pick<Agent, "id" | "name" | "surname" | "username" | "status">; company: Company; }>`** — Liste les agents actifs et leurs entreprises pour un consommateur.
- **`deleteAssignation(assignationId: number): void`** — Supprime une assignation, sous réserve des contraintes référentielles.

### Salles et capacités

- **`createRoom(companyId: number, name: string, limit: number): Room`** — Crée une salle pour une entreprise ; -1 indique une capacité illimitée.
- **`getRoom(companyId: number, name: string): Room | null`** — Recherche une salle par entreprise et nom.
- **`listRooms(companyId: number, includeInactive = false): Room[]`** — Liste les salles d’une entreprise, avec option d’inclure les salles inactives.
- **`updateRoomLimit(companyId: number, name: string, limit: number): Room`** — Modifie la capacité d’une salle.
- **`renameRoom(companyId: number, oldName: string, newName: string): Room`** — Renomme une salle.
- **`setRoomActive(companyId: number, name: string, active: boolean): Room`** — Active ou désactive une salle.
- **`deleteRoom(companyId: number, name: string): void`** — Supprime une salle si aucune réunion historique ne la référence.
- **`isRoomAvailable(companyId: number, name: string, startAt: string | Date, durationMinutes: number, excludeMeetingId?: number): boolean`** — Indique si une salle peut accueillir une réunion sur le créneau donné.
- **`getRoomPeakOccupancy(companyId: number, name: string, startAt: string | Date, durationMinutes: number, excludeMeetingId?: number): number`** — Calcule le pic de chevauchement des réunions sur un créneau.
- **`getRoomsAvailability(companyId: number, startAt: string | Date, durationMinutes: number): RoomAvailability[]`** — Retourne la disponibilité et la capacité restante des salles actives.

### Demandes, disponibilités et suggestions

- **`createAvailabilityRequest(assignationId: number, requestedHours: number): AvailabilityRequest`** — Crée une demande de disponibilité, en convertissant les heures en minutes.
- **`getAvailabilityRequest(id: number): AvailabilityRequest | null`** — Recherche une demande de disponibilité par identifiant.
- **`getAvailabilityRequestProgress(id: number): AvailabilityRequestProgress | null`** — Retourne une demande avec les minutes planifiées et restantes.
- **`listAvailabilityRequestsForAssignation(assignationId: number): AvailabilityRequestProgress[]`** — Liste les demandes d’une assignation avec leur progression.
- **`setAvailabilityRequestStatus(id: number, status: AvailabilityRequestStatus): AvailabilityRequest`** — Modifie le statut d’une demande de disponibilité.
- **`createDisponibility(input: CreateDisponibilityInput): Disponibility`** — Ajoute un créneau de disponibilité d’un consommateur.
- **`getDisponibilityById(id: number): Disponibility | null`** — Recherche un créneau de disponibilité par identifiant.
- **`listDisponibilitiesForRequest(requestId: number): Disponibility[]`** — Liste les disponibilités associées à une demande, après nettoyage des créneaux expirés.
- **`listDisponibilitiesForAssignation(assignationId: number, from?: string | Date, to?: string | Date): Disponibility[]`** — Liste les disponibilités d’une assignation qui chevauchent éventuellement une plage.
- **`updateDisponibility(id: number, input: { startAt: string | Date; durationMinutes: number; love: number }): Disponibility`** — Modifie un créneau de disponibilité.
- **`deleteDisponibility(id: number): void`** — Supprime un créneau de disponibilité.
- **`createSuggestion(input: CreateSuggestionInput): Suggestion`** — Ajoute une suggestion de créneau pour un contrat d’agent.
- **`getSuggestionById(id: number): Suggestion | null`** — Recherche une suggestion par identifiant.
- **`listSuggestionsForContract(contractId: number, from?: string | Date, to?: string | Date): Suggestion[]`** — Liste les suggestions d’un contrat qui chevauchent éventuellement une plage.
- **`updateSuggestion(id: number, input: { startAt: string | Date; durationMinutes: number; love: number }): Suggestion`** — Modifie une suggestion de créneau.
- **`deleteSuggestion(id: number): void`** — Supprime une suggestion.
- **`cleanExpiredIntervals(now: string | Date = new Date()): CleanupResult`** — Rogne les créneaux partiellement expirés et supprime ceux qui sont entièrement passés.
- **`listCompatibleSlotsForConsumer(consumerId: number, from: string | Date, to: string | Date): CompatibleSlot[]`** — Recherche les créneaux compatibles entre disponibilités et suggestions pour un consommateur.

### Réunions

- **`createMeetingFromAvailability(input: CreateMeetingFromAvailabilityInput): MeetingCreationResult`** — Crée une réunion à partir d’un créneau compatible ; prend en charge l’idempotence.
- **`getMeetingById(id: number): Meeting | null`** — Recherche une réunion par identifiant.
- **`listMeetingsForAssignation(assignationId: number, from?: string | Date, to?: string | Date): Meeting[]`** — Liste les réunions d’une assignation, avec filtre de plage facultatif.
- **`listMeetingsForCompany(companyId: number, from?: string | Date, to?: string | Date): Meeting[]`** — Liste les réunions d’une entreprise, avec filtre de plage facultatif.
- **`updateMeetingComment(id: number, comment: string): Meeting`** — Met à jour le commentaire d’une réunion.
- **`setMeetingRoom(id: number, roomName: string | null): Meeting`** — Affecte ou retire une salle à une réunion.
- **`markMeetingDone(id: number, actualDurationMinutes: number | null = null): Meeting`** — Marque une réunion comme terminée, avec la durée réellement effectuée (`null` = durée réservée). Les prix et la progression des demandes utilisent cette durée réelle.
- **`cancelMeeting(id: number, actorRole: Role, actorId: number, now: string | Date = new Date()): Meeting`** — Annule une réunion en enregistrant le rôle et l’identifiant de l’auteur.

### Répétition automatique (générateurs)

Un générateur répète un créneau chaque semaine (ou toutes les N semaines) : horaires de l’agent (`kind = "suggestion"`, par contrat) ou disponibilités du consommateur (`kind = "disponibility"`, par assignation et demande). L’heure est une heure locale dans `timeZone`. Les occurrences des deux prochaines semaines (`GENERATION_DAYS`) sont créées comme de vraies lignes avec `generatorId` et `generatorOccurrence` (date locale) ; le client dessine les suivantes à la volée (`shared/recurrence.ts`).

- **`createSuggestionGenerator(contractId, input: GeneratorInput): Generator`** / **`createDisponibilityGenerator(assignationId, requestId, input): Generator`** — Crée la règle et génère ses occurrences à venir.
- **`getGeneratorById(id)`**, **`listSuggestionGeneratorsForAgent(agentId)`**, **`listDisponibilityGeneratorsForAgent(agentId)`**, **`listDisponibilityGeneratorsForConsumer(consumerId)`**, **`listSuggestionGeneratorsForConsumer(consumerId)`** — Lecture des règles (avec leurs annulations).
- **`updateGenerator(id, input)`** — Change la règle : les occurrences futures encore liées sont supprimées puis regénérées.
- **`deleteGenerator(id)`** — Supprime la règle et ses occurrences futures.
- **`cancelGeneratorOccurrence(id, date)`** / **`restoreGeneratorOccurrence(id, date)`** — « Cancelator » : annule (ou rétablit) l’occurrence d’une date locale.
- **`materializeGenerators(now?, until?)`** — Génère les occurrences jusqu’à deux semaines (ou jusqu’à `until`). Appelée à chaque lecture des disponibilités et avant une réservation.

Modifier ou supprimer à la main une ligne générée l’annule dans son générateur (elle n’est jamais recréée).

## Remarques

- `createAvailabilityRequest` reçoit une durée en heures ; les durées des créneaux et réunions sont exprimées en minutes.
- `love` est une valeur comprise entre `0` et `1`.
- Une capacité de salle égale à `-1` signifie illimitée.
- Les dates sont acceptées sous forme de `string` ou `Date` selon la signature, puis normalisées en ISO.
- `withTransaction` prend un callback synchrone ; les savepoints permettent les transactions imbriquées.

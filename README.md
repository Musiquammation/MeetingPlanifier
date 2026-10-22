# API Documentation

## Overview

Cette API gère un système de gestion de rendez-vous entre enseignants (Teachers) et clients (Clients), organisé par des administrateurs (Admins).

## Routes Admin

### POST /admin/createAccount
Crée un nouveau compte administrateur.
```json
{
  "id": "admin_id",
  "name": "Admin Name",
  "password": "password123"
}
```

### POST /admin/connect
Connecte un administrateur et retourne une session.
```json
{
  "id": "admin_id",
  "password": "password123"
}
```
**Réponse:**
```json
{
  "success": true,
  "session": "session_key_hex"
}
```

### POST /admin/disconnect
Déconnecte un administrateur.
```json
{
  "session": "session_key"
}
```

### POST /admin/teachers/add
Crée une promesse de compte enseignant (valable 7 jours).
```json
{
  "session": "session_key",
  "teacherId": "teacher_id",
  "name": "Teacher Name"
}
```
**Réponse:**
```json
{
  "success": true,
  "promiseId": "promise_id_hex"
}
```

### GET /admin/teachers/list
Liste tous les enseignants de l'admin.
**Query params:** `session`

### GET /admin/teachers/dispos
Liste les disponibilités d'un enseignant.
**Query params:** `session`, `teacherId`

### POST /admin/teachers/giveClient
Assigne un client à un enseignant.
```json
{
  "session": "session_key",
  "teacherId": "teacher_id",
  "clientId": 123
}
```

### POST /admin/teachers/ungiveClient
Retire un client d'un enseignant.
```json
{
  "session": "session_key",
  "teacherId": "teacher_id",
  "clientId": 123
}
```

### POST /admin/rooms/create
Crée une nouvelle salle.
```json
{
  "session": "session_key",
  "name": "Room A"
}
```
**Réponse:**
```json
{
  "success": true,
  "roomId": 1
}
```

### DELETE /admin/rooms/delete
Supprime une salle.
```json
{
  "session": "session_key",
  "roomId": 1
}
```

### GET /admin/rooms/list
Liste toutes les salles de l'admin.
**Query params:** `session`

### GET /admin/rooms/occupations
Liste les occupations des salles sur une période.
**Query params:** `session`, `start` (ISO date), `end` (ISO date)

### GET /admin/meetings/list
Liste tous les meetings de l'admin.
**Query params:** `session`

### GET /admin/clients/list
Liste tous les clients de l'admin.
**Query params:** `session`

### POST /admin/clients/create
Crée un nouveau client. Si un AbsoluteClient avec le même nom existe déjà, le réutilise.
```json
{
  "session": "session_key",
  "name": "Client Name"
}
```
**Réponse:**
```json
{
  "success": true,
  "clientId": 123
}
```

### GET /admin/clients/dispos
Liste les disponibilités d'un client sur une période.
**Query params:** `session`, `clientId`, `start` (ISO date), `end` (ISO date)

---

## Routes Teacher

### POST /teacher/createAccount
Crée un compte enseignant à partir d'une promesse.
```json
{
  "promiseId": "promise_id_hex",
  "password": "password123"
}
```

### POST /teacher/connect
Connecte un enseignant.
```json
{
  "id": "teacher_id",
  "password": "password123"
}
```
**Réponse:**
```json
{
  "success": true,
  "session": "session_key_hex"
}
```

### POST /teacher/disconnect
Déconnecte un enseignant.
```json
{
  "session": "session_key"
}
```

### POST /teacher/dispos/add
Ajoute une disponibilité.
```json
{
  "session": "session_key",
  "start": "2024-12-01T09:00:00Z",
  "end": "2024-12-01T12:00:00Z"
}
```
**Réponse:**
```json
{
  "success": true,
  "id": 1
}
```

### PUT /teacher/dispos/update
Modifie une disponibilité.
```json
{
  "session": "session_key",
  "disponibilityId": 1,
  "start": "2024-12-01T09:00:00Z",
  "end": "2024-12-01T13:00:00Z"
}
```

### DELETE /teacher/dispos/remove
Supprime une disponibilité.
```json
{
  "session": "session_key",
  "disponibilityId": 1
}
```

### GET /teacher/dispos/list
Liste toutes les disponibilités de l'enseignant.
**Query params:** `session`

### GET /teacher/meetings/list
Liste les meetings sur une période.
**Query params:** `session`, `start` (ISO date), `end` (ISO date)

### POST /teacher/meetings/fix
Crée un nouveau meeting.
```json
{
  "session": "session_key",
  "start": "2024-12-01T10:00:00Z",
  "end": "2024-12-01T11:00:00Z",
  "clientDisponibilityIds": [1, 2],
  "place": 0,  // 0=ROOM, 1=HOME, 2=ONLINE
  "price": 50.00
}
```
**Note:** Si `place=0`, le système choisit automatiquement une salle disponible.

**Réponse:**
```json
{
  "success": true,
  "meetingId": 1
}
```

### DELETE /teacher/meetings/unfix
Annule un meeting.
```json
{
  "session": "session_key",
  "meetingId": 1
}
```

### GET /teacher/clients/list
Liste tous les clients assignés à l'enseignant.
**Query params:** `session`

### GET /teacher/clients/getDispos
Liste les disponibilités des clients sur une période.
**Query params:** `session`, `start` (ISO date), `end` (ISO date)

### GET /teacher/rooms/list
Liste toutes les salles disponibles.
**Query params:** `session`

### GET /teacher/rooms/occupations
Liste les occupations des salles sur une période.
**Query params:** `session`, `start` (ISO date), `end` (ISO date)

---

## Routes Client

### GET /client/listTeachers
Liste tous les enseignants du client.
**Query params:** `clientId`

### DELETE /client/unfixMeeting
Annule un meeting.
```json
{
  "clientId": 123,
  "meetingId": 1
}
```

### POST /client/dispos/add
Ajoute une disponibilité.
```json
{
  "clientId": 123,
  "start": "2024-12-01T14:00:00Z",
  "end": "2024-12-01T16:00:00Z",
  "grade": 1  // 1-3, niveau de priorité
}
```

### DELETE /client/dispos/remove
Supprime une disponibilité.
```json
{
  "clientId": 123,
  "disponibilityId": 1
}
```

### GET /client/dispos/list
Liste toutes les disponibilités du client.
**Query params:** `clientId`

### PUT /client/dispos/updateGrade
Modifie la priorité d'une disponibilité.
```json
{
  "clientId": 123,
  "disponibilityId": 1,
  "grade": 2
}
```

### PUT /client/dispos/updateHours
Modifie les horaires d'une disponibilité.
```json
{
  "clientId": 123,
  "disponibilityId": 1,
  "start": "2024-12-01T14:00:00Z",
  "end": "2024-12-01T17:00:00Z"
}
```

---

## Codes d'erreur

- **400** - Paramètres manquants ou invalides
- **401** - Session invalide ou informations de connexion incorrectes
- **403** - Accès non autorisé
- **404** - Ressource non trouvée
- **409** - Conflit (ex: salle occupée, chevauchement de disponibilités)
- **500** - Erreur serveur

---

## Notes

1. **Sessions:** Les sessions expirent après 1 heure d'inactivité.
2. **TeacherPromise:** Les promesses de compte enseignant expirent après 7 jours.
3. **Dates:** Toutes les dates doivent être au format ISO 8601 (ex: `2024-12-01T10:00:00Z`).
4. **Place values:**
   - 0 = ROOM (en salle)
   - 1 = HOME (à domicile)
   - 2 = ONLINE (en ligne)
5. **Grade values:** 1-3, où 1 est la priorité la plus haute.
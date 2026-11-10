-- AlterTable
ALTER TABLE `user` ADD COLUMN `doctorId` VARCHAR(191) NULL,
    ADD COLUMN `role` ENUM('PATIENT', 'DOCTOR', 'ADMIN') NOT NULL DEFAULT 'PATIENT';

-- CreateTable
CREATE TABLE `PatientProfile` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `kind` ENUM('SELF', 'RELATIVE') NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `birthDate` DATE NOT NULL,
    `phone` VARCHAR(32) NOT NULL,
    `relationship` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PatientProfile_ownerId_kind_idx`(`ownerId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DoctorSchedule` (
    `id` VARCHAR(191) NOT NULL,
    `doctorId` VARCHAR(191) NOT NULL,
    `weekday` TINYINT UNSIGNED NOT NULL,
    `startMinute` SMALLINT UNSIGNED NOT NULL,
    `endMinute` SMALLINT UNSIGNED NOT NULL,
    `durationMinutes` SMALLINT UNSIGNED NOT NULL,
    `effectiveFrom` DATE NOT NULL,
    `effectiveTo` DATE NULL,

    INDEX `DoctorSchedule_doctorId_weekday_effectiveFrom_idx`(`doctorId`, `weekday`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DoctorScheduleException` (
    `id` VARCHAR(191) NOT NULL,
    `doctorId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `isClosed` BOOLEAN NOT NULL DEFAULT false,
    `intervals` JSON NULL,

    UNIQUE INDEX `DoctorScheduleException_doctorId_date_key`(`doctorId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppointmentSlot` (
    `id` VARCHAR(191) NOT NULL,
    `doctorId` VARCHAR(191) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `isOpen` BOOLEAN NOT NULL DEFAULT true,
    `scheduleVersion` INTEGER UNSIGNED NOT NULL DEFAULT 1,

    INDEX `AppointmentSlot_doctorId_isOpen_startsAt_idx`(`doctorId`, `isOpen`, `startsAt`),
    UNIQUE INDEX `AppointmentSlot_doctorId_startsAt_key`(`doctorId`, `startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SlotOccupancy` (
    `slotId` VARCHAR(191) NOT NULL,
    `appointmentId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `SlotOccupancy_appointmentId_key`(`appointmentId`),
    PRIMARY KEY (`slotId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Appointment` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `bookerId` VARCHAR(191) NOT NULL,
    `patientProfileId` VARCHAR(191) NOT NULL,
    `doctorId` VARCHAR(191) NOT NULL,
    `slotId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `reason` TEXT NOT NULL,
    `symptoms` TEXT NULL,
    `patientSnapshot` JSON NOT NULL,
    `doctorNameSnapshot` VARCHAR(191) NOT NULL,
    `addressSnapshot` VARCHAR(500) NOT NULL,
    `feeSnapshot` DECIMAL(12, 2) NOT NULL,
    `cancelDeadline` DATETIME(3) NOT NULL,
    `rescheduleDeadline` DATETIME(3) NOT NULL,
    `policySnapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Appointment_code_key`(`code`),
    INDEX `Appointment_bookerId_status_createdAt_idx`(`bookerId`, `status`, `createdAt`),
    INDEX `Appointment_doctorId_status_createdAt_idx`(`doctorId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppointmentEvent` (
    `id` VARCHAR(191) NOT NULL,
    `appointmentId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `oldStatus` ENUM('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED') NULL,
    `newStatus` ENUM('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED') NOT NULL,
    `oldSlotId` VARCHAR(191) NULL,
    `newSlotId` VARCHAR(191) NULL,
    `reason` TEXT NULL,
    `version` INTEGER UNSIGNED NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AppointmentEvent_appointmentId_createdAt_idx`(`appointmentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppointmentAttachment` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `appointmentId` VARCHAR(191) NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `originalName` VARCHAR(255) NOT NULL,
    `verifiedMime` VARCHAR(64) NOT NULL,
    `size` INTEGER UNSIGNED NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AppointmentAttachment_storageKey_key`(`storageKey`),
    INDEX `AppointmentAttachment_ownerId_appointmentId_expiresAt_idx`(`ownerId`, `appointmentId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IdempotencyRecord` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `operation` VARCHAR(64) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `normalizedRequestHash` CHAR(64) NOT NULL,
    `appointmentId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `IdempotencyRecord_userId_operation_key_key`(`userId`, `operation`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccessAudit` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `oldRole` ENUM('PATIENT', 'DOCTOR', 'ADMIN') NOT NULL,
    `newRole` ENUM('PATIENT', 'DOCTOR', 'ADMIN') NOT NULL,
    `oldDoctorId` VARCHAR(191) NULL,
    `newDoctorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AccessAudit_targetId_createdAt_idx`(`targetId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `User_doctorId_key` ON `User`(`doctorId`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PatientProfile` ADD CONSTRAINT `PatientProfile_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DoctorSchedule` ADD CONSTRAINT `DoctorSchedule_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DoctorScheduleException` ADD CONSTRAINT `DoctorScheduleException_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppointmentSlot` ADD CONSTRAINT `AppointmentSlot_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SlotOccupancy` ADD CONSTRAINT `SlotOccupancy_slotId_fkey` FOREIGN KEY (`slotId`) REFERENCES `AppointmentSlot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SlotOccupancy` ADD CONSTRAINT `SlotOccupancy_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Appointment` ADD CONSTRAINT `Appointment_bookerId_fkey` FOREIGN KEY (`bookerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Appointment` ADD CONSTRAINT `Appointment_patientProfileId_fkey` FOREIGN KEY (`patientProfileId`) REFERENCES `PatientProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Appointment` ADD CONSTRAINT `Appointment_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Appointment` ADD CONSTRAINT `Appointment_slotId_fkey` FOREIGN KEY (`slotId`) REFERENCES `AppointmentSlot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppointmentEvent` ADD CONSTRAINT `AppointmentEvent_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppointmentEvent` ADD CONSTRAINT `AppointmentEvent_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppointmentAttachment` ADD CONSTRAINT `AppointmentAttachment_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppointmentAttachment` ADD CONSTRAINT `AppointmentAttachment_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IdempotencyRecord` ADD CONSTRAINT `IdempotencyRecord_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IdempotencyRecord` ADD CONSTRAINT `IdempotencyRecord_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccessAudit` ADD CONSTRAINT `AccessAudit_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccessAudit` ADD CONSTRAINT `AccessAudit_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

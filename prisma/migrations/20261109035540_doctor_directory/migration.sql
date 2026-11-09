-- CreateTable
CREATE TABLE `Doctor` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `specialty` VARCHAR(191) NOT NULL,
    `introduction` TEXT NOT NULL,
    `qualifications` TEXT NOT NULL,
    `experienceYears` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `consultationFee` DECIMAL(12, 2) NOT NULL,
    `address` VARCHAR(500) NOT NULL,
    `averageRating` DECIMAL(2, 1) NULL,
    `reviewCount` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Doctor_isActive_specialty_idx`(`isActive`, `specialty`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

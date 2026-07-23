const {
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	SlashCommandBuilder,
	PermissionsBitField,
} = require('discord.js');

// عرّف هذا المتغير بملف .env حق بوتك (اختياري) عشان الطلبات ترسل لروم معين
const REQUESTS_CHANNEL_ID = process.env.REQUESTS_CHANNEL_ID || process.env.DONE_TEXT_CHANNEL_ID;

// ============ تعريف أمر /panel (ضيفه لقائمة أوامرك وقت التسجيل/الـ deploy) ============
const panelCommandData = new SlashCommandBuilder()
	.setName('panel')
	.setDescription('نشر لوحة Warn والاستقالة')
	.toJSON();

function isModerator(member) {
	return member.permissions.has(PermissionsBitField.Flags.ManageMessages);
}

// ===================== بناء رسالة اللوحة (3 أزرار Warn حمراء + طلب استقالة) =====================
function buildPanelMessage() {
	const embed = new EmbedBuilder()
		.setColor(0xf59e0b)
		.setTitle('📋 لوحة الإجازات أو الاستقالات')
		.setDescription(
			[
				'تم إنشاء لوحة الطلبات، استخدم الأزرار بالأسفل.',
				'',
				'✅ سيتم إشعار الإدارة لمراجعة الطلب.',
				'⚡ عند قبول الإدارة سيتم تحديث حالة الطلب تلقائيًا.',
			].join('\n')
		)
		.setTimestamp();

	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId('request_warn_1').setLabel('Warn 1').setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId('request_warn_2').setLabel('Warn 2').setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId('request_warn_3').setLabel('Warn 3').setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId('request_resign').setLabel('طلب استقالة').setStyle(ButtonStyle.Danger)
	);

	return { embeds: [embed], components: [row] };
}

function buildReviewButtons(requesterId, requestKey) {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`request_action|approve|${requesterId}|${requestKey}`)
			.setLabel('قبول الطلب')
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId(`request_action|reject|${requesterId}|${requestKey}`)
			.setLabel('رفض الطلب')
			.setStyle(ButtonStyle.Danger)
	);
}

function disabledRows(rows) {
	return rows.map((row) => {
		const nextRow = ActionRowBuilder.from(row);
		nextRow.components = nextRow.components.map((component) =>
			ButtonBuilder.from(component).setDisabled(true)
		);
		return nextRow;
	});
}

/**
 * نادِ هالدالة أول شي جوا الـ interactionCreate حق بوتك الحالي.
 * ترجع true إذا هي اللي عالجت التفاعل (يعني توقف عن أي معالجة ثانية له)،
 * وترجع false إذا التفاعل مالها علاقة باللوحة عشان يكمل بوتك معالجته العادية.
 */
async function handlePanelInteraction(interaction, client) {
	// ---------- أمر /panel ----------
	if (interaction.isChatInputCommand() && interaction.commandName === 'panel') {
		if (!isModerator(interaction.member)) {
			await interaction.reply({ content: 'تحتاج صلاحية Manage Messages لنشر اللوحة.', ephemeral: true });
			return true;
		}
		await interaction.reply(buildPanelMessage());
		return true;
	}

	// ---------- أزرار اللوحة ----------
	if (interaction.isButton()) {
		const warnButtonLabels = {
			request_warn_1: 'Warn 1',
			request_warn_2: 'Warn 2',
			request_warn_3: 'Warn 3',
		};

		if (warnButtonLabels[interaction.customId] || interaction.customId === 'request_resign') {
			const isResign = interaction.customId === 'request_resign';
			const modalKind = isResign ? 'resign' : interaction.customId;

			const modal = new ModalBuilder()
				.setCustomId(`submit_request|${modalKind}`)
				.setTitle(isResign ? 'نموذج طلب استقالة' : `نموذج ${warnButtonLabels[interaction.customId]}`);

			const reasonInput = new TextInputBuilder()
				.setCustomId('reason')
				.setLabel(isResign ? 'سبب الاستقالة' : 'سبب الطلب')
				.setStyle(TextInputStyle.Paragraph)
				.setRequired(true)
				.setMaxLength(500);

			const periodOrDateInput = new TextInputBuilder()
				.setCustomId('period')
				.setLabel(isResign ? 'تاريخ آخر يوم (اختياري)' : 'مدة الإجازة (مثال: 3 أيام)')
				.setStyle(TextInputStyle.Short)
				.setRequired(!isResign)
				.setMaxLength(100);

			modal.addComponents(
				new ActionRowBuilder().addComponents(reasonInput),
				new ActionRowBuilder().addComponents(periodOrDateInput)
			);

			await interaction.showModal(modal);
			return true;
		}

		if (interaction.customId.startsWith('request_action|')) {
			if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
				await interaction.reply({ content: 'لا تملك صلاحية مراجعة الطلبات.', ephemeral: true });
				return true;
			}

			const parts = interaction.customId.split('|');
			const action = parts[1];
			const requesterId = parts[2];
			const approved = action === 'approve';

			const oldEmbed = interaction.message.embeds[0];
			const embed = EmbedBuilder.from(oldEmbed);
			const otherFields = (embed.data.fields || []).filter((field) => field.name !== 'الحالة');
			embed
				.setColor(approved ? 0x22c55e : 0xef4444)
				.setFields(...otherFields, {
					name: 'الحالة',
					value: approved
						? `✅ تم القبول بواسطة <@${interaction.user.id}>`
						: `❌ تم الرفض بواسطة <@${interaction.user.id}>`,
					inline: false,
				})
				.setFooter({ text: `تمت المراجعة بواسطة ${interaction.user.tag}` });

			await interaction.update({
				embeds: [embed],
				components: disabledRows(interaction.message.components),
			});

			const requester = await client.users.fetch(requesterId).catch(() => null);
			if (requester) {
				requester
					.send(
						approved
							? `تم قبول طلبك في سيرفر ${interaction.guild.name}.`
							: `تم رفض طلبك في سيرفر ${interaction.guild.name}.`
					)
					.catch(() => null);
			}
			return true;
		}
	}

	// ---------- استقبال نموذج (Modal) الطلبات ----------
	if (interaction.isModalSubmit() && interaction.customId.startsWith('submit_request|')) {
		const reqKind = interaction.customId.split('|')[1]; // request_warn_1/2/3 أو resign
		const isResign = reqKind === 'resign';
		const reason = interaction.fields.getTextInputValue('reason');
		const period = interaction.fields.getTextInputValue('period') || 'غير محدد';

		let targetChannel = interaction.channel;
		if (REQUESTS_CHANNEL_ID) {
			const maybeChannel = await interaction.guild.channels.fetch(REQUESTS_CHANNEL_ID).catch(() => null);
			if (maybeChannel && maybeChannel.isTextBased()) {
				targetChannel = maybeChannel;
			}
		}

		const requestKey = interaction.id;
		const typeLabel = isResign
			? 'استقالة'
			: { request_warn_1: 'Warn 1', request_warn_2: 'Warn 2', request_warn_3: 'Warn 3' }[reqKind];

		const reviewEmbed = new EmbedBuilder()
			.setColor(0xf59e0b)
			.setTitle(isResign ? '📌 طلب استقالة جديد' : `📌 طلب ${typeLabel} جديد`)
			.addFields(
				{ name: 'المستخدم', value: `<@${interaction.user.id}>`, inline: true },
				{ name: 'المعرف', value: interaction.user.id, inline: true },
				{ name: 'النوع', value: typeLabel, inline: true },
				{ name: 'السبب', value: reason },
				{ name: isResign ? 'آخر يوم' : 'المدة', value: period, inline: false },
				{ name: 'الحالة', value: '⏳ بانتظار المراجعة', inline: false }
			)
			.setTimestamp();

		await targetChannel.send({
			embeds: [reviewEmbed],
			components: [buildReviewButtons(interaction.user.id, requestKey)],
		});

		await interaction.reply({
			content: 'تم إرسال طلبك للإدارة، انتظر قرار القبول أو الرفض.',
			ephemeral: true,
		});
		return true;
	}

	return false; // مالها علاقة باللوحة، خلي بوتك يكمل معالجته العادية
}

module.exports = { panelCommandData, handlePanelInteraction };

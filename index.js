const {
  Client,
  GatewayIntentBits,
  Events,
  ActivityType,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  REST,
  Routes
} = require('discord.js');

// ===== القيم تُقرأ من متغيرات البيئة في لوحة تحكم الاستضافة =====
const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const WARN_ROLES = {
  warn_1: process.env.WARN_ROLE_1 || '1529732965171597422',
  warn_2: process.env.WARN_ROLE_2 || '1529733000185643028',
  warn_3: process.env.WARN_ROLE_3 || '1529733023271092316'
};

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌ تأكد من إضافة متغيرات البيئة: BOT_TOKEN, CLIENT_ID, GUILD_ID في لوحة تحكم الاستضافة.');
  process.exit(1);
}

// ===== إعدادات مستويات التحذير =====
const warnInfo = {
  warn_1: { label: 'Warn 1', color: 0xF1C40F, emoji: '🟡', style: ButtonStyle.Secondary },
  warn_2: { label: 'Warn 2', color: 0xE67E22, emoji: '🟠', style: ButtonStyle.Primary },
  warn_3: { label: 'Warn 3', color: 0xE74C3C, emoji: '🔴', style: ButtonStyle.Danger }
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ===== تسجيل الأمر /panel =====
const commands = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('إرسال لوحة تحذيرات الإدارة (Warn 1 / Warn 2 / Warn 3)')
    .toJSON()
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log('✅ تم تسجيل الأمر /panel بنجاح.');
  } catch (error) {
    console.error('❌ خطأ أثناء تسجيل الأوامر:', error);
  }
}

// ===== عند تشغيل البوت =====
client.once(Events.ClientReady, async () => {
  console.log(`✅ تم تسجيل الدخول باسم ${client.user.tag}`);
  client.user.setActivity('إدارة التحذيرات ⚠️', { type: ActivityType.Watching });
  await registerCommands();
});

// ===== التعامل مع كل التفاعلات =====
client.on(Events.InteractionCreate, async (interaction) => {
  // 1) تنفيذ /panel
  if (interaction.isChatInputCommand() && interaction.commandName === 'panel') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({ content: '❌ ليس لديك صلاحية استخدام هذا الأمر.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('⚠️ لوحة تحذيرات الإدارة')
      .setDescription(
        'اختر مستوى التحذير المناسب من الأزرار بالأسفل.\n\n' +
        '**Warn 1** — تحذير أول\n' +
        '**Warn 2** — تحذير ثاني\n' +
        '**Warn 3** — تحذير ثالث (إجراء نهائي)\n\n' +
        'عند الضغط على أي زر سيُطلب منك إدخال **آيدي الشخص** و**سبب التحذير**، وسيتم منح الرتبة المناسبة تلقائياً.'
      )
      .setColor(0xF1C40F)
      .setFooter({ text: 'نظام التحذيرات الآلي' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      Object.entries(warnInfo).map(([id, info]) =>
        new ButtonBuilder().setCustomId(id).setLabel(info.label).setStyle(info.style).setEmoji(info.emoji)
      )
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }

  // 2) الضغط على زر Warn -> فتح المودال
  if (interaction.isButton() && warnInfo[interaction.customId]) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({ content: '❌ ليس لديك صلاحية استخدام هذا الزر.', ephemeral: true });
    }

    const level = interaction.customId;
    const { label } = warnInfo[level];

    const modal = new ModalBuilder().setCustomId(`warn_modal_${level}`).setTitle(`تسجيل تحذير - ${label}`);

    const userIdInput = new TextInputBuilder()
      .setCustomId('target_id')
      .setLabel('آيدي الشخص (User ID)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('مثال: 123456789012345678')
      .setRequired(true);

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('سبب التحذير')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('اكتب سبب التحذير هنا...')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(userIdInput),
      new ActionRowBuilder().addComponents(reasonInput)
    );

    return interaction.showModal(modal);
  }

  // 3) استلام المودال -> منح الرتبة وتسجيل التحذير
  if (interaction.isModalSubmit() && interaction.customId.startsWith('warn_modal_')) {
    const level = interaction.customId.replace('warn_modal_', '');
    const { label, color } = warnInfo[level];
    const roleId = WARN_ROLES[level];

    const targetId = interaction.fields.getTextInputValue('target_id').trim();
    const reason = interaction.fields.getTextInputValue('reason').trim();

    await interaction.deferReply({ ephemeral: true });

    let member;
    try {
      member = await interaction.guild.members.fetch(targetId);
    } catch {
      return interaction.editReply({ content: '❌ لم يتم العثور على عضو بهذا الآيدي في السيرفر.' });
    }

    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) {
      return interaction.editReply({ content: `❌ لم يتم العثور على رتبة ${label}. تأكد من صحة الآيدي في متغيرات البيئة.` });
    }

    try {
      await member.roles.add(role, `تحذير ${label} - بواسطة ${interaction.user.tag} - السبب: ${reason}`);
    } catch (error) {
      console.error(error);
      return interaction.editReply({
        content: '❌ لم أتمكن من إعطاء الرتبة. تأكد أن رتبة البوت أعلى من رتبة التحذير وأن لديه صلاحية "Manage Roles".'
      });
    }

    const logEmbed = new EmbedBuilder()
      .setTitle(`⚠️ تم تسجيل تحذير - ${label}`)
      .addFields(
        { name: 'العضو', value: `<@${member.id}> (${member.id})`, inline: true },
        { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'السبب', value: reason }
      )
      .setColor(color)
      .setTimestamp();

    await interaction.channel.send({ embeds: [logEmbed] });

    try {
      await member.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`⚠️ لقد تلقيت تحذير: ${label}`)
            .addFields({ name: 'السبب', value: reason })
            .setColor(color)
            .setTimestamp()
        ]
      });
    } catch {
      // العضو مغلق الخاص - يتم تجاهل الخطأ
    }

    return interaction.editReply({ content: `✅ تم تسجيل ${label} للعضو <@${member.id}> ومنحه الرتبة بنجاح.` });
  }
});

client.login(TOKEN);
